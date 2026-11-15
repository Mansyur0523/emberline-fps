// Bots: nine computer opponents and teammates that walk the waypoint graph,
// hold sites, push lanes, see and shoot back, plant and defuse the bomb.
// Each bot is a small state machine: move along a BFS route, hold and scan,
// engage when an enemy is visible, retreat when hurt, and channel a plant or
// a defuse when its side's objective says so. Shots are resolved by main.js:
// a bot only asks for a shot (muzzle + direction) and main.js raycasts it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './player.js';
import { WAYPOINTS, findPath, nearestWaypoint } from './world.js';

const BOT_HEALTH = 100;
const BOT_SPEED = 4.3;
const BOT_MAG = 25;
const BOT_DAMAGE = 18;
const BOT_HEAD_DAMAGE = 55;
const BOT_RELOAD_TIME = 2.1;
const VISION_RANGE = 42;
const VISION_HALF_ANGLE = 0.96;
const PERCEIVE_EVERY = 0.12;

const EMBER_NAMES = ['ASHER', 'COAL', 'SLAG', 'TINDER'];
const ASH_NAMES = ['FROST', 'GLASS', 'IRON', 'MICA', 'ONYX'];

function makeNameSprite(name, team) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = team === 'ember' ? 'rgba(255,122,26,0.92)' : 'rgba(55,182,201,0.92)';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.33, 1);
  sprite.position.y = 2.05;
  return sprite;
}

function buildBody(team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'ember' ? '#c2571a' : '#2b6d7d'),
    roughness: 0.75, metalness: 0.1,
  });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22201d'), roughness: 0.8 });
  const visor = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'ember' ? PALETTE.accent : PALETTE.teal),
    emissive: new THREE.Color(team === 'ember' ? PALETTE.accent : PALETTE.teal),
    emissiveIntensity: 0.9, roughness: 0.3,
  });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.32), suit);
  torso.position.y = 1.05;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), dark);
  head.position.y = 1.62;
  head.userData.part = 'head';
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), visor);
  visorMesh.position.set(0, 1.63, 0.15);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), dark);
  legL.position.set(-0.15, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.18, 1.2, -0.3);
  group.add(torso, head, visorMesh, legL, legR, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head };
}

export function createBots(scene, world, rng) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const bots = [];
  const hitMeshes = [];
  const tmpVector = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();

  function spawnBot(name, team, x, z) {
    const { group, torso, head } = buildBody(team);
    const sprite = makeNameSprite(name, team);
    group.add(sprite);
    group.position.set(x, 0, z);
    scene.add(group);
    const { mover, move } = createMover(world.colliders, new THREE.Vector3(x, 0, z));
    const bot = {
      id: name, name, team, group, torso, head, sprite, mover, move,
      health: BOT_HEALTH, alive: true, fall: 0,
      role: 'roam', site: null, path: [], pathIndex: 0,
      holdUntil: 0, perceiveTimer: rng() * PERCEIVE_EVERY,
      target: null, targetIsPlayer: false, lastSeenAt: -99, lastSeenPos: new THREE.Vector3(),
      burstLeft: 0, burstTimer: 0, pauseTimer: 0, reloadLeft: 0, mag: BOT_MAG,
      aimError: 0.35, strafeDir: 1, strafeTimer: 0,
      channel: null, channelProgress: 0, channelSite: null,
      hasBomb: false, alertPos: null, alertAt: -99, damagedAt: -99,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < EMBER_NAMES.length; i += 1) {
    spawnBot(EMBER_NAMES[i], 'ember', -2 + i * 1.4, 13.5);
  }
  for (let i = 0; i < ASH_NAMES.length; i += 1) {
    spawnBot(ASH_NAMES[i], 'ash', -8 + i * 4, -14.5);
  }

  function setPath(bot, destination) {
    const from = nearestWaypoint(bot.mover.position.x, bot.mover.position.z);
    bot.path = findPath(from, destination);
    bot.pathIndex = 0;
  }

  function losClear(from, to) {
    const distance = from.distanceTo(to);
    if (distance > VISION_RANGE) return false;
    tmpVector.copy(to).sub(from);
    raycaster.set(from, tmpVector.clone().normalize());
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance > distance - 0.6;
  }

  function perceive(bot, now, player) {
    bot.perceiveTimer -= PERCEIVE_EVERY;
    if (bot.perceiveTimer > 0) return;
    bot.perceiveTimer = PERCEIVE_EVERY;
    const eye = tmpVector.set(bot.mover.position.x, bot.mover.position.y + 1.55, bot.mover.position.z);
    let best = null;
    let bestDistance = Infinity;
    let bestIsPlayer = false;
    const facingX = -Math.sin(bot.mover.yaw);
    const facingZ = -Math.cos(bot.mover.yaw);
    const consider = (position, distance, isPlayer, ref) => {
      if (distance > VISION_RANGE || distance >= bestDistance) return;
      tmpTarget.copy(position).sub(eye).normalize();
      const dot = tmpTarget.x * facingX + tmpTarget.z * facingZ;
      const recentlyHurt = now - bot.damagedAt < 2;
      if (dot < Math.cos(VISION_HALF_ANGLE) && !recentlyHurt && !(bot.alertPos && now - bot.alertAt < 1.5)) return;
      if (!losClear(eye, position)) return;
      best = ref;
      bestDistance = distance;
      bestIsPlayer = isPlayer;
    };
    if (bot.team === 'ash' && player.alive) {
      const playerPos = new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z);
      consider(playerPos, eye.distanceTo(playerPos), true, null);
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      const otherPos = new THREE.Vector3(other.mover.position.x, other.mover.position.y + 1.2, other.mover.position.z);
      consider(otherPos, eye.distanceTo(otherPos), false, other);
    }
    if (best || bestIsPlayer) {
      bot.target = best;
      bot.targetIsPlayer = bestIsPlayer;
      bot.lastSeenAt = now;
      bot.lastSeenPos.copy(best ? new THREE.Vector3(best.mover.position.x, best.mover.position.y + 1.2, best.mover.position.z) : new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z));
    } else if (now - bot.lastSeenAt > 1.2) {
      bot.target = null;
      bot.targetIsPlayer = false;
    }
  }

  function faceToward(bot, x, z) {
    const dx = x - bot.mover.position.x;
    const dz = z - bot.mover.position.z;
    bot.mover.yaw = Math.atan2(-dx, -dz);
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = WAYPOINTS[bot.path[bot.pathIndex]];
    const dx = node.x - bot.mover.position.x;
    const dz = node.z - bot.mover.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.7) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const sin = Math.sin(bot.mover.yaw);
    const cos = Math.cos(bot.mover.yaw);
    faceToward(bot, node.x, node.z);
    const wishX = -sin * 1;
    const wishZ = -cos * 1;
    bot.move(dt, wishX, wishZ, speed, false, false);
    return false;
  }

  function aimPoint(bot, targetPos, distance) {
    const moving = bot.targetIsPlayer ? 1 : 0;
    const error = bot.aimError * (0.35 + distance / 42) * (moving ? 1.4 : 1);
    return new THREE.Vector3(
      targetPos.x + (rng() * 2 - 1) * error,
      targetPos.y + (rng() * 2 - 1) * error * 0.7,
      targetPos.z + (rng() * 2 - 1) * error,
    );
  }

  function damage(bot, amount, part, attackerName) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.damagedAt = performance.now() / 1000;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.health = 0;
    bot.fall = 0;
    bot.channel = null;
    bot.group.traverse((mesh) => {
      if (mesh.isSprite) mesh.visible = false;
    });
    return true;
  }

  function resetRound(assignments) {
    const emberSpawns = [[-2, 13.5], [-0.6, 13.5], [0.8, 13.5], [2.2, 13.5]];
    const ashSpawns = [[-8, -14.5], [-4, -14.5], [0, -14.5], [4, -14.5], [8, -14.5]];
    let emberIndex = 0;
    let ashIndex = 0;
    for (const bot of bots) {
      bot.alive = true;
      bot.health = BOT_HEALTH;
      bot.fall = 0;
      bot.mag = BOT_MAG;
      bot.reloadLeft = 0;
      bot.burstLeft = 0;
      bot.burstTimer = 0;
      bot.pauseTimer = 0;
      bot.target = null;
      bot.channel = null;
      bot.channelProgress = 0;
      bot.hasBomb = false;
      bot.alertPos = null;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      bot.group.traverse((mesh) => {
        if (mesh.isSprite) mesh.visible = true;
      });
      if (bot.team === 'ember') {
        const [x, z] = emberSpawns[emberIndex % emberSpawns.length];
        emberIndex += 1;
        bot.mover.position.set(x, 0, z);
        bot.mover.velocity.set(0, 0, 0);
        bot.mover.yaw = Math.PI;
        bot.role = 'attacker';
        bot.site = assignments.ember[emberIndex - 1] || 'A';
        setPath(bot, bot.site === 'A' ? 'aSite' : 'bSite');
      } else {
        const [x, z] = ashSpawns[ashIndex % ashSpawns.length];
        ashIndex += 1;
        bot.mover.position.set(x, 0, z);
        bot.mover.velocity.set(0, 0, 0);
        bot.mover.yaw = 0;
        bot.role = 'defender';
        bot.site = assignments.ash[ashIndex - 1] || 'A';
        const holdNode = bot.site === 'A' ? (ashIndex % 2 === 0 ? 'aCorner' : 'aSite') : (ashIndex % 2 === 0 ? 'bCorner' : 'bSite');
        if (holdNode === 'aSite' || holdNode === 'bSite') bot.role = 'holder';
        setPath(bot, holdNode);
      }
    }
  }

  function step(dt, now, api) {
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.45);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.1;
        }
        continue;
      }
      perceive(bot, now, api.player);

      const bombPlanted = api.bomb.planted;
      const plantedSite = api.bomb.site;

      // Objective channels: planting (attackers) and defusing (defenders).
      if (bot.channel) {
        const target = bot.channel === 'plant' ? 3.5 : 5;
        bot.channelProgress += dt;
        faceToward(bot, bot.mover.position.x - Math.sin(bot.mover.yaw), bot.mover.position.z - Math.cos(bot.mover.yaw));
        if (bot.target && now - bot.lastSeenAt < 0.5) {
          bot.channel = null;
          bot.channelProgress = 0;
        } else if (bot.channelProgress >= target) {
          const done = bot.channel;
          const site = bot.channelSite;
          bot.channel = null;
          bot.channelProgress = 0;
          if (done === 'plant') api.onPlant(bot, site);
          else api.onDefuse(bot, site);
        }
        continue;
      }

      if (bot.target && !bot.target.alive) {
        bot.target = null;
        bot.targetIsPlayer = false;
      }
      if (bot.target || bot.targetIsPlayer) {
        const targetPos = bot.targetIsPlayer
          ? new THREE.Vector3(api.player.position.x, api.player.position.y + 1.2, api.player.position.z)
          : new THREE.Vector3(bot.target.mover.position.x, bot.target.mover.position.y + 1.2, bot.target.mover.position.z);
        const distance = bot.mover.position.distanceTo(targetPos);
        faceToward(bot, targetPos.x, targetPos.z);
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeDir = rng() > 0.5 ? 1 : -1;
          bot.strafeTimer = 0.7 + rng() * 0.6;
        }
        if (distance > 26) {
          const sin = Math.sin(bot.mover.yaw);
          const cos = Math.cos(bot.mover.yaw);
          bot.move(dt, -sin, -cos, BOT_SPEED, false, false);
        } else if (distance > 6) {
          const sin = Math.sin(bot.mover.yaw);
          const cos = Math.cos(bot.mover.yaw);
          bot.move(dt, cos * bot.strafeDir, -sin * bot.strafeDir, BOT_SPEED * 0.55, false, false);
        }
        if (bot.reloadLeft > 0) {
          bot.reloadLeft -= dt;
          if (bot.reloadLeft <= 0) bot.mag = BOT_MAG;
        } else if (bot.mag <= 0) {
          bot.reloadLeft = BOT_RELOAD_TIME;
        } else if (bot.burstLeft > 0) {
          bot.burstTimer -= dt;
          if (bot.burstTimer <= 0) {
            bot.burstTimer = 0.11;
            bot.burstLeft -= 1;
            bot.mag -= 1;
            const muzzle = new THREE.Vector3(bot.mover.position.x, bot.mover.position.y + 1.35, bot.mover.position.z);
            const aim = aimPoint(bot, targetPos, distance);
            const direction = aim.sub(muzzle).normalize();
            api.fireShot(bot, muzzle, direction);
          }
        } else {
          bot.pauseTimer -= dt;
          if (bot.pauseTimer <= 0) {
            bot.burstLeft = 3 + Math.floor(rng() * 3);
            bot.pauseTimer = 0.7 + rng() * 0.7;
          }
        }
      } else if (bombPlanted && bot.team === 'ash') {
        const destination = plantedSite === 'A' ? 'aSite' : 'bSite';
        const sitePos = plantedSite === 'A' ? world.sites.A.center : world.sites.B.center;
        const distance = Math.hypot(bot.mover.position.x - sitePos.x, bot.mover.position.z - sitePos.z);
        if (distance < 2.6) {
          const nearest = bots.filter((other) => other.alive && other.team === 'ash' && other.channel !== 'defuse')
            .sort((a, b) => a.mover.position.distanceTo(sitePos) - b.mover.position.distanceTo(sitePos))[0];
          if (nearest === bot) {
            bot.channel = 'defuse';
            bot.channelSite = plantedSite;
            bot.channelProgress = 0;
          } else {
            bot.holdUntil = now + 0.5;
          }
        } else {
          moveAlongPath(bot, dt, BOT_SPEED);
          if (bot.pathIndex >= bot.path.length) setPath(bot, destination);
        }
      } else if (bot.team === 'ember' && bot.hasBomb && !bombPlanted) {
        const destination = bot.site === 'A' ? 'aSite' : 'bSite';
        const sitePos = bot.site === 'A' ? world.sites.A.center : world.sites.B.center;
        const distance = Math.hypot(bot.mover.position.x - sitePos.x, bot.mover.position.z - sitePos.z);
        if (distance < 2.4) {
          bot.channel = 'plant';
          bot.channelSite = bot.site;
          bot.channelProgress = 0;
        } else {
          moveAlongPath(bot, dt, BOT_SPEED);
          if (bot.pathIndex >= bot.path.length) setPath(bot, destination);
        }
      } else if (bot.alertPos && now - bot.alertAt < 4 && !bot.target) {
        faceToward(bot, bot.alertPos.x, bot.alertPos.z);
        const distance = Math.hypot(bot.mover.position.x - bot.alertPos.x, bot.mover.position.z - bot.alertPos.z);
        if (distance > 3 && now < bot.holdUntil) {
          const node = nearestWaypoint(bot.alertPos.x, bot.alertPos.z);
          setPath(bot, node);
          bot.alertPos = null;
          moveAlongPath(bot, dt, BOT_SPEED);
        }
      } else if (bot.pathIndex < bot.path.length) {
        moveAlongPath(bot, dt, BOT_SPEED);
      } else {
        if (bot.holdUntil < now) bot.holdUntil = now + 1.5 + rng() * 2;
        const scan = Math.sin(now * 0.5 + bot.name.charCodeAt(0)) * 0.9;
        bot.mover.yaw += scan * dt * 0.4;
      }

      bot.group.position.set(bot.mover.position.x, bot.mover.position.y, bot.mover.position.z);
      bot.group.rotation.y = bot.mover.yaw;
    }
  }

  function alertTo(position) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const distance = bot.mover.position.distanceTo(position);
      if (distance < 26) {
        bot.alertPos = position.clone();
        bot.alertAt = performance.now() / 1000;
        bot.holdUntil = performance.now() / 1000 + 1;
      }
    }
  }

  return {
    bots,
    hitMeshes,
    step,
    damage,
    resetRound,
    alertTo,
    aliveCount(team) {
      return bots.filter((bot) => bot.alive && bot.team === team).length;
    },
    nearestAliveAttacker(position) {
      let best = null;
      let bestDistance = Infinity;
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'ember') continue;
        const distance = bot.mover.position.distanceTo(position);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = bot;
        }
      }
      return best;
    },
  };
}
