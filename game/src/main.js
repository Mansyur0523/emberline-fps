// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate, plus the round state machine (buy -> live -> round end),
// the shooting that main.js owns, the bomb channels, and the deterministic
// ?shot=start|play|bomb|end captures, which pose a frame, render it twice,
// freeze it and set window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArmory, createTracers, createSparks, createGrenades, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb, PLANT_TIME } from './bomb.js';
import { createEconomy, WIN_BONUS, LOSS_BONUS, KILL_BONUS, PLANT_BONUS } from './economy.js';
import { createHud } from './hud.js';
import { sfx, resumeAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const ROUND_END_SECONDS = 4;
const WIN_ROUNDS = 5;
const BOT_DAMAGE = 18;
const BOT_HEAD_DAMAGE = 55;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bots = createBots(scene, world, random);
const armory = createArmory(camera);
const tracers = createTracers(scene);
const sparks = createSparks(scene);
const bomb = createBomb(scene);
const economy = createEconomy();
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const grenades = createGrenades(scene, world.colliders, onGrenadeExplode);

// An invisible box the bots raycast against when they shoot the player.
const playerHitbox = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.72, 0.72), new THREE.MeshBasicMaterial({ visible: false }));
playerHitbox.position.set(0, 0.86, 14);
scene.add(playerHitbox);

const shootTargets = world.shootables.concat(bots.hitMeshes);
const botShotTargets = world.shootables.concat(bots.hitMeshes, [playerHitbox]);
const direction = new THREE.Vector3();
const muzzlePoint = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();

let phase = 'lobby';
let round = 1;
let scoreEmber = 0;
let scoreAsh = 0;
let timer = BUY_SECONDS;
let playerHealth = 100;
let playerAlive = true;
let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let channel = null;
let spectateBot = null;
let shakeTime = 0;
let shakeMag = 0;
let lastBeep = 0;
let kills = 0;

const body = player.state;

function syncCamera() {
  if (!playerAlive && spectateBot && spectateBot.alive) {
    const bot = spectateBot.mover;
    const backX = bot.position.x + Math.sin(bot.yaw) * 3.2;
    const backZ = bot.position.z + Math.cos(bot.yaw) * 3.2;
    camera.position.set(backX, bot.position.y + 2.1, backZ);
    camera.lookAt(bot.position.x - Math.sin(bot.yaw) * 6, bot.position.y + 1.3, bot.position.z - Math.cos(bot.yaw) * 6);
    return;
  }
  let shakeX = 0;
  let shakeY = 0;
  if (shakeTime > 0) {
    shakeX = (random() * 2 - 1) * shakeMag;
    shakeY = (random() * 2 - 1) * shakeMag;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch + shakeY, body.yaw + shakeX, 0, 'YXZ');
}

function setPhase(next, seconds) {
  phase = next;
  timer = seconds;
}

function resetPlayerForRound() {
  body.position.set(0, 0, 14);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  playerHealth = 100;
  playerAlive = true;
  spectateBot = null;
  channel = null;
  hud.hideSpectate();
  hud.setHealth(100);
  armory.resetRound();
  hud.setAmmo(armory.states[armory.current].mag, armory.states[armory.current].reserve, armory.def().name);
}

function startRound() {
  const assignments = { ember: ['A', 'A', 'B', 'B'], ash: ['A', 'A', 'B', 'B', 'A'] };
  bots.resetRound(assignments);
  bomb.reset('player');
  resetPlayerForRound();
  economy.resetRound();
  hud.hideBanner();
  hud.hideChannel();
  setPhase('buy', BUY_SECONDS);
  hud.setScore(scoreEmber, scoreAsh, round);
  hud.setMoney(economy.money);
  hud.setGrenades(economy.grenades);
  hud.setBombStatus('');
  hud.setTimer(timer, 'buy');
  openBuyMenu();
  hud.banner(`ROUND ${round}`, 'Buy phase — press B for the shop', 2200);
}

function startMatch() {
  scoreEmber = 0;
  scoreAsh = 0;
  round = 1;
  kills = 0;
  economy.resetMatch();
  armory.resetMatch();
  startRound();
}

function openBuyMenu() {
  if (phase !== 'buy') return;
  const owned = new Set(Object.keys(WEAPONS).filter((id) => armory.owned(id)));
  hud.showBuy(economy.buyList(), economy.money, owned);
}

function buyItem(item) {
  if (phase !== 'buy') return;
  if (item.kind === 'weapon' && armory.owned(item.id)) return;
  if (!economy.buy(item)) {
    sfx.deny();
    return;
  }
  if (item.kind === 'weapon') {
    armory.buy(item.id);
    armory.equip(item.id);
    hud.setAmmo(armory.states[item.id].mag, armory.states[item.id].reserve, armory.def().name);
  }
  sfx.buy();
  hud.setMoney(economy.money);
  hud.setGrenades(economy.grenades);
  openBuyMenu();
}

function endRound(winner, reason) {
  if (phase === 'roundEnd' || phase === 'matchEnd') return;
  if (winner === 'ember') scoreEmber += 1;
  else scoreAsh += 1;
  economy.add(winner === 'ember' ? WIN_BONUS : LOSS_BONUS);
  hud.setMoney(economy.money);
  setPhase('roundEnd', ROUND_END_SECONDS);
  hud.hideChannel();
  hud.hideBuy();
  channel = null;
  const title = winner === 'ember' ? 'EMBER WINS THE ROUND' : 'ASH WINS THE ROUND';
  hud.banner(title, reason, 3400);
  if (winner === 'ember') sfx.roundWin();
  else sfx.roundLose();
  hud.setScore(scoreEmber, scoreAsh, round);
  hud.killfeed(`<b>${winner === 'ember' ? 'EMBER' : 'ASH'}</b> takes round ${round} — ${reason}`);
}

function endMatch() {
  setPhase('matchEnd', 0);
  const winner = scoreEmber > scoreAsh ? 'EMBER' : 'ASH';
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showOverlay('matchEnd', `${winner} takes the match ${scoreEmber} — ${scoreAsh}. You scored ${kills} eliminations.`);
}

function checkRoundEnd() {
  if (phase !== 'live') return;
  const ashAlive = bots.aliveCount('ash');
  const emberAlive = bots.aliveCount('ember') + (playerAlive ? 1 : 0);
  if (ashAlive === 0) {
    endRound('ember', 'Ash team eliminated');
    return;
  }
  if (emberAlive === 0 && bomb.state.status !== 'planted') {
    endRound('ash', 'Ember team eliminated');
  }
}

function damagePlayer(amount, fromName) {
  if (!playerAlive || phase !== 'live') return;
  playerHealth -= amount;
  hud.setHealth(playerHealth);
  hud.damageFlash();
  sfx.hurt();
  if (playerHealth > 0) return;
  playerAlive = false;
  hud.killfeed(`<b>${fromName}</b> ▸ <span class="you">You</span>`);
  spectateBot = bots.nearestAliveAttacker(body.position) || null;
  if (spectateBot) hud.showSpectate(spectateBot.name);
  if (document.pointerLockElement) document.exitPointerLock();
  if (bomb.state.status === 'carried' && bomb.state.carrier === 'player') {
    bomb.dropAt(body.position);
  }
  checkRoundEnd();
}

function resolveShot(origin, dir, weaponDef, shooter) {
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(shooter === 'player' ? shootTargets : botShotTargets, false);
  let end = tmpPoint.copy(origin).addScaledVector(dir, 60);
  for (const hit of hits) {
    if (hit.object.userData.bot === shooter) continue;
    if (hit.object === playerHitbox && shooter === 'player') continue;
    end = hit.point;
    if (hit.object === playerHitbox) {
      const isHead = hit.point.y > body.position.y + 1.45;
      damagePlayer(isHead ? BOT_HEAD_DAMAGE : BOT_DAMAGE, shooter.name);
    } else if (hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const isHead = hit.object.userData.part === 'head';
      const damage = weaponDef.damage * (isHead ? weaponDef.headMult : 1);
      const killed = bots.damage(victim, damage, isHead ? 'head' : 'torso', shooter === 'player' ? 'You' : shooter.name);
      if (shooter === 'player') {
        hud.hitMarker(killed, killed ? 4000 : 90);
        sfx.hit();
        if (killed) {
          kills += 1;
          economy.add(KILL_BONUS);
          hud.setMoney(economy.money);
          sfx.kill();
          hud.killfeed(`<span class="you">You</span> ▸ <b>${victim.name}</b> [${weaponDef.short}]${isHead ? ' — HEADSHOT' : ''}`);
          if (victim.hasBomb) {
            bomb.dropAt(victim.mover.position);
            victim.hasBomb = false;
          }
          checkRoundEnd();
        }
      }
    } else {
      sparks.burst(hit.point, 10);
    }
    break;
  }
  return end;
}

function shootPlayer(spread) {
  const def = armory.def();
  if (!armory.takeRound()) {
    sfx.dryFire();
    return;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  const muzzle = armory.muzzleWorldPosition(muzzlePoint);
  const end = resolveShot(camera.position, direction, def, 'player');
  tracers.fire(muzzle, end);
  armory.pullTrigger();
  player.recoil(def.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  sfx.shot(def.sound);
  bots.alertTo(body.position);
  hud.setAmmo(armory.states[armory.current].mag, armory.states[armory.current].reserve, def.name);
}

function shootBot(bot, muzzle, dir) {
  const def = { damage: BOT_DAMAGE, headMult: BOT_HEAD_DAMAGE / BOT_DAMAGE, short: 'VK-7' };
  const end = resolveShot(muzzle, dir, def, bot);
  tracers.fire(muzzle, end);
  sfx.shot('rifle');
}

function onGrenadeExplode(at) {
  sparks.burst(at, 24);
  sfx.explosion();
  shakeTime = 0.35;
  shakeMag = 0.03;
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 12, 1.5);
  flashLight.position.copy(at).add(new THREE.Vector3(0, 0.6, 0));
  scene.add(flashLight);
  setTimeout(() => scene.remove(flashLight), 220);
  const targets = [];
  if (playerAlive) targets.push({ position: body.position, isPlayer: true });
  for (const bot of bots.bots) {
    if (bot.alive) targets.push({ position: bot.mover.position, isPlayer: false, bot });
  }
  for (const target of targets) {
    const distance = target.position.distanceTo(at);
    if (distance > GRENADE.radius) continue;
    const damage = Math.round(GRENADE.maxDamage * (1 - distance / GRENADE.radius));
    if (target.isPlayer) {
      const looking = camera.getWorldDirection(new THREE.Vector3()).dot(tmpPoint.copy(at).sub(camera.position).normalize());
      if (distance < 9 && looking > 0.4) hud.flash();
      damagePlayer(damage, 'Spark');
    } else {
      const killed = bots.damage(target.bot, damage, 'torso', 'Spark');
      if (killed) hud.killfeed(`<b>Spark</b> ▸ <b>${target.bot.name}</b>`);
      if (target.bot.hasBomb) {
        bomb.dropAt(target.bot.mover.position);
        target.bot.hasBomb = false;
      }
    }
  }
  checkRoundEnd();
}

function throwGrenade() {
  if (!economy.useGrenade()) {
    sfx.deny();
    return;
  }
  hud.setGrenades(economy.grenades);
  camera.getWorldDirection(direction);
  const from = camera.position.clone().addScaledVector(direction, 0.6);
  from.y -= 0.1;
  grenades.throwGrenade(from, direction);
}

function plantProgress(dt, pressed) {
  if (phase !== 'live' || !playerAlive) return;
  if (bomb.state.status !== 'carried' || bomb.state.carrier !== 'player') return;
  const inA = world.sites.A.box.containsPoint(body.position);
  const inB = world.sites.B.box.containsPoint(body.position);
  const site = inA ? 'A' : inB ? 'B' : null;
  if (!site || !pressed.has('KeyE')) {
    if (channel) {
      channel = null;
      hud.hideChannel();
    }
    return;
  }
  if (!channel) channel = { kind: 'plant', progress: 0, site };
  channel.progress += dt / PLANT_TIME;
  hud.showChannel(`PLANTING SPARK — SITE ${site}`, channel.progress);
  if (channel.progress >= 1) {
    channel = null;
    hud.hideChannel();
    bomb.plant(site, body.position);
    economy.add(PLANT_BONUS);
    hud.setMoney(economy.money);
    sfx.plantDone();
    hud.killfeed(`<span class="you">You</span> planted the spark at Site ${site}`);
    hud.setBombStatus(`SPARK PLANTED — SITE ${site}`);
    bots.alertTo(body.position);
  }
}

function step(dt, now) {
  elapsed += dt;
  if (phase === 'buy' || phase === 'live' || phase === 'roundEnd') timer -= dt;

  if (phase === 'buy' && timer <= 0) {
    hud.hideBuy();
    setPhase('live', ROUND_SECONDS);
    hud.banner(`ROUND ${round}`, 'Plant the spark or eliminate Ash', 2000);
  } else if (phase === 'live' && timer <= 0 && bomb.state.status !== 'planted') {
    endRound('ash', 'Time expired — Ash holds the yard');
  } else if (phase === 'roundEnd' && timer <= 0) {
    if (scoreEmber >= WIN_ROUNDS || scoreAsh >= WIN_ROUNDS) {
      endMatch();
    } else {
      round += 1;
      startRound();
    }
  }

  const pressed = input.takePressed();
  if (pressed.has('KeyB') && phase === 'buy') {
    if (hud.buyOpen) hud.hideBuy();
    else openBuyMenu();
  }
  if (hud.buyOpen && phase === 'buy') {
    const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    buyKeys.forEach((code, index) => {
      if (pressed.has(code)) {
        const item = economy.buyList()[index];
        if (item) buyItem(item);
      }
    });
  } else if (phase === 'live' || phase === 'buy') {
    const slots = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    slots.forEach((code, index) => {
      if (pressed.has(code)) {
        const id = Object.keys(WEAPONS)[index];
        if (armory.equip(id)) hud.setAmmo(armory.states[id].mag, armory.states[id].reserve, armory.def().name);
      }
    });
  }
  if (pressed.has('KeyG') && phase === 'live' && playerAlive) throwGrenade();
  if (pressed.has('KeyR') && playerAlive) {
    if (armory.reload()) sfx.reload();
  }

  if (playerAlive && (phase === 'buy' || phase === 'live')) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.step(dt, input.state.keys);
    if (phase === 'live' && input.state.firing && armory.ready()) {
      shootPlayer(armory.spread(player.groundSpeed()));
    }
    plantProgress(dt, input.state.keys);
  } else {
    input.takeLook();
  }
  armory.step(dt, player.groundSpeed(), playerAlive && input.state.keys.size > 0);

  if (shakeTime > 0) shakeTime -= dt;

  if (phase === 'live') {
    bots.step(dt, now, {
      player: { position: body.position, alive: playerAlive },
      bomb: { planted: bomb.state.status === 'planted', site: bomb.state.site },
      fireShot: shootBot,
      onPlant(bot, site) {
        bomb.plant(site, bot.mover.position);
        hud.setBombStatus(`SPARK PLANTED — SITE ${site}`);
        hud.killfeed(`<b>${bot.name}</b> planted the spark at Site ${site}`);
        sfx.plantDone();
      },
      onDefuse(bot, site) {
        bomb.defuse();
        endRound('ash', `${bot.name} defused the spark`);
      },
    });
  }

  if (bomb.state.status === 'dropped') {
    const carrier = bots.nearestAliveAttacker(bomb.state.position);
    if (carrier && carrier.mover.position.distanceTo(bomb.state.position) < 1.4) {
      carrier.hasBomb = true;
      bomb.state.status = 'carried';
      bomb.state.carrier = carrier;
      hud.killfeed(`<b>${carrier.name}</b> picked up the spark`);
    }
  }
  bomb.step(dt);
  if (bomb.state.status === 'planted') {
    const interval = bomb.beepInterval();
    if (elapsed - lastBeep >= interval) {
      lastBeep = elapsed;
      sfx.beep();
    }
    hud.setBombStatus(`SPARK PLANTED — SITE ${bomb.state.site} — ${Math.ceil(bomb.state.timer)}s`);
    if (bomb.state.timer <= 0) {
      bomb.explode();
      onGrenadeExplode(bomb.state.position);
      endRound('ember', 'The spark detonated');
    }
  }

  grenades.step(dt);
  tracers.step(dt);
  sparks.step(dt);

  playerHitbox.position.set(body.position.x, body.position.y + 0.86, body.position.z);

  hud.setTimer(timer, phase);
  hud.setCrosshairGap(6 + armory.spread(player.groundSpeed()) * 320);
  hud.setAmmo(armory.states[armory.current].mag, armory.states[armory.current].reserve, armory.def().name);
  if (phase === 'live' && !playerAlive && spectateBot && !spectateBot.alive) {
    spectateBot = bots.nearestAliveAttacker(body.position) || null;
    if (spectateBot) hud.showSpectate(spectateBot.name);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP, now / 1000);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  resumeAudio();
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (phase === 'lobby') startMatch();
  } else if (phase !== 'matchEnd' && phase !== 'roundEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (phase === 'matchEnd') {
    startMatch();
    input.requestLock();
    return;
  }
  input.requestLock();
});
hud.onBuy((item) => buyItem(item));

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP, elapsed);
}

function aimAtBot(bot, height = 1.25) {
  const target = new THREE.Vector3(bot.mover.position.x, bot.mover.position.y + height, bot.mover.position.z);
  const dx = target.x - body.position.x;
  const dy = target.y - (body.position.y + body.eye);
  const dz = target.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  hud.hideBanner();
  hud.hideSpectate();
  startMatch();
  phase = 'live';
  timer = 61;
  if (name === 'start') {
    setPhase('buy', 8);
    body.position.set(0, 0, 14);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    openBuyMenu();
    hud.banner('ROUND 1', 'Buy phase — press B for the shop', 4000);
  } else if (name === 'play') {
    round = 2;
    setPhase('live', 61);
    armory.buy('rifle');
    armory.equip('rifle');
    const victim = bots.bots.find((bot) => bot.team === 'ash');
    victim.mover.position.set(0.5, 0, -3);
    victim.mover.yaw = Math.PI;
    victim.path = [];
    victim.pauseTimer = 9;
    const watcher = bots.bots.find((bot) => bot.team === 'ash' && bot !== victim);
    watcher.mover.position.set(-4, 0, -7);
    watcher.mover.yaw = Math.PI * 0.75;
    watcher.path = [];
    watcher.pauseTimer = 9;
    body.position.set(-1.5, 0, 5);
    settle(10);
    aimAtBot(victim);
    shootPlayer(0);
    settle(6);
    aimAtBot(victim);
    shootPlayer(0);
    settle(6);
    body.pitch += 0.02;
    aimAtBot(victim, 1.62);
    shootPlayer(0);
    settle(2);
    hud.setScore(0, 0, 2);
  } else if (name === 'bomb') {
    round = 3;
    setPhase('live', 41);
    armory.buy('rifle');
    armory.equip('rifle');
    body.position.set(-13.5, 0, -9.5);
    const guard = bots.bots.find((bot) => bot.team === 'ash');
    guard.mover.position.set(-11, 0, -13.5);
    guard.mover.yaw = Math.PI * 0.5;
    guard.path = [];
    guard.pauseTimer = 9;
    const mate = bots.bots.find((bot) => bot.team === 'ember');
    mate.mover.position.set(-17.5, 0, -9);
    mate.mover.yaw = -Math.PI * 0.5;
    mate.path = [];
    mate.pauseTimer = 9;
    settle(10);
    aimAtBot(guard);
    channel = { kind: 'plant', progress: 0.6, site: 'A' };
    hud.showChannel('PLANTING SPARK — SITE A', 0.6);
    hud.setScore(1, 1, 3);
  } else {
    round = 4;
    scoreEmber = 3;
    scoreAsh = 1;
    setPhase('roundEnd', 3);
    const fallen = bots.bots.find((bot) => bot.team === 'ash');
    fallen.alive = false;
    fallen.fall = 0.85;
    fallen.group.rotation.x = -1.28;
    fallen.group.position.y = -0.08;
    body.position.set(0, 0, 12);
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    hud.setScore(3, 1, 4);
    hud.banner('EMBER WINS THE ROUND', 'Ash team eliminated', 4000);
  }
  hud.setAmmo(armory.states[armory.current].mag, armory.states[armory.current].reserve, armory.def().name);
  hud.setHealth(playerHealth);
  hud.setMoney(economy.money);
  hud.setGrenades(economy.grenades);
  hud.setTimer(timer, phase);
  // startMatch()/startRound() opens the buy menu; only the 'start' shot
  // keeps it open. The other shots jump straight to live/roundEnd, so the
  // buy-phase timer expiry that normally hides it never runs.
  if (name !== 'start') hud.hideBuy();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setMoney(economy.money);
hud.setAmmo(armory.states.pistol.mag, armory.states.pistol.reserve, armory.def().name);
hud.showOverlay('start');
if (shot) runShot(shot);
else {
  requestAnimationFrame(frame);
  window.__gameReady = true;
}
