// Weapons: four fictional guns and one grenade, each with its own numbers,
// view model and feel. The armory owns magazines, reserves, reloads and the
// view-model animation; main.js owns the ray and the damage. Spread grows
// with movement speed, so stopping to aim pays. A tracer pool and an impact
// spark pool are shared by the player and the bots, and both reuse their
// meshes instead of allocating per shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', short: 'P9', price: 0, slot: 1,
    damage: 15, headMult: 4, mag: 12, reserve: 999, gap: 0.22, reloadTime: 1.3,
    spreadStill: 0.004, spreadMoving: 0.03, kick: 0.012, auto: false, sound: 'pistol',
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Carbine', short: 'VK-7', price: 2700, slot: 2,
    damage: 33, headMult: 4, mag: 30, reserve: 90, gap: 0.096, reloadTime: 1.9,
    spreadStill: 0.0022, spreadMoving: 0.028, kick: 0.014, auto: true, sound: 'rifle',
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', short: 'Hornet', price: 1500, slot: 3,
    damage: 22, headMult: 4, mag: 32, reserve: 96, gap: 0.068, reloadTime: 1.6,
    spreadStill: 0.006, spreadMoving: 0.034, kick: 0.009, auto: true, sound: 'smg',
  },
  dmr: {
    id: 'dmr', name: 'Longshot DMR', short: 'Longshot', price: 4500, slot: 4,
    damage: 80, headMult: 4, mag: 5, reserve: 15, gap: 0.85, reloadTime: 2.6,
    spreadStill: 0.0009, spreadMoving: 0.02, kick: 0.05, auto: false, sound: 'dmr',
  },
};

export const GRENADE = { name: 'Spark Grenade', price: 300, fuse: 2.5, radius: 5, maxDamage: 90 };

const MOVE_REFERENCE = 5.4;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), grip);
    handle.position.set(0, -0.07, 0.08);
    model.add(slide, handle);
    model.position.set(0.22, -0.19, -0.38);
  } else if (def.id === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.34), body);
    const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), grip);
    suppressor.rotation.x = Math.PI / 2;
    suppressor.position.set(0, 0.02, -0.28);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), accent);
    mag.position.set(0, -0.11, -0.02);
    model.add(receiver, suppressor, mag);
    model.position.set(0.24, -0.2, -0.4);
  } else if (def.id === 'dmr') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), grip);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10), accent);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, -0.05);
    model.add(receiver, barrel, scope);
    model.position.set(0.24, -0.21, -0.46);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), accent);
    mag.position.set(0, -0.1, 0.02);
    model.add(receiver, barrel, stock, mag);
    model.position.set(0.24, -0.2, -0.42);
  }
  return model;
}

export function createArmory(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const states = {};
  for (const def of Object.values(WEAPONS)) {
    states[def.id] = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, owned: def.price === 0 };
  }

  let current = 'rifle';
  states.rifle.owned = false;
  let flashLeft = 0;
  let kick = 0;
  let bobPhase = 0;

  function currentDef() {
    return WEAPONS[current];
  }

  function showModel() {
    for (const [id, model] of Object.entries(models)) model.visible = id === current;
  }
  showModel();

  return {
    states,
    get current() {
      return current;
    },
    def() {
      return currentDef();
    },
    owned(id) {
      return states[id].owned;
    },
    buy(id) {
      states[id].owned = true;
      states[id].mag = WEAPONS[id].mag;
      states[id].reserve = WEAPONS[id].reserve;
    },
    equip(id) {
      if (!states[id].owned || id === current) return false;
      current = id;
      showModel();
      return true;
    },
    resetRound() {
      for (const def of Object.values(WEAPONS)) {
        if (states[def.id].owned) {
          states[def.id].mag = def.mag;
          states[def.id].reserve = def.reserve;
          states[def.id].cooldown = 0;
          states[def.id].reloadLeft = 0;
        }
      }
      if (!states[current].owned) {
        current = 'pistol';
        showModel();
      }
      flashLeft = 0;
      kick = 0;
    },
    resetMatch() {
      for (const def of Object.values(WEAPONS)) {
        states[def.id].owned = def.price === 0;
        states[def.id].mag = def.mag;
        states[def.id].reserve = def.reserve;
        states[def.id].cooldown = 0;
        states[def.id].reloadLeft = 0;
      }
      current = 'pistol';
      showModel();
    },
    ready() {
      const state = states[current];
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      const state = states[current];
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    pullTrigger() {
      const def = currentDef();
      states[current].cooldown = def.gap;
      flashLeft = 0.06;
      kick = def.id === 'dmr' ? 0.11 : 0.055;
    },
    reload() {
      const def = currentDef();
      const state = states[current];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      const def = currentDef();
      return def.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * def.spreadMoving;
    },
    muzzleWorldPosition(out) {
      out.set(0.24, -0.17, -0.95);
      return camera.localToWorld(out);
    },
    step(dt, speed, moving) {
      const state = states[current];
      state.cooldown = Math.max(0, state.cooldown - dt);
      flashLeft = Math.max(0, flashLeft - dt);
      kick += (0 - kick) * Math.min(1, dt * 14);
      const model = models[current];
      bobPhase += dt * (moving ? speed * 1.6 : 0);
      model.position.z = -0.42 + kick + (current === 'dmr' ? -0.04 : 0);
      model.position.y = -0.2 + (moving ? Math.sin(bobPhase * 2) * 0.006 : 0) + (current === 'pistol' ? 0.01 : 0);
      model.rotation.x = kick * 2.2;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        const def = currentDef();
        model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
        if (state.reloadLeft === 0) {
          const need = def.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
      flash.visible = flashLeft > 0;
      flash.rotation.z = flashLeft * 30;
      flashLight.intensity = flashLeft > 0 ? 18 : 0;
    },
  };
}

export function createTracers(scene) {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pool = [];
  for (let i = 0; i < 24; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), material);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, life: 0 });
  }
  let cursor = 0;
  const mid = new THREE.Vector3();
  return {
    fire(from, to) {
      const tracer = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      mid.addVectors(from, to).multiplyScalar(0.5);
      tracer.mesh.position.copy(mid);
      tracer.mesh.lookAt(to);
      tracer.mesh.scale.set(1, 1, Math.max(0.1, from.distanceTo(to)));
      tracer.mesh.visible = true;
      tracer.life = 0.07;
    },
    step(dt) {
      for (const tracer of pool) {
        if (tracer.life <= 0) continue;
        tracer.life -= dt;
        if (tracer.life <= 0) tracer.mesh.visible = false;
      }
    },
  };
}

export function createSparks(scene) {
  const COUNT = 96;
  const positions = new Float32Array(COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: new THREE.Color('#ffcf7a'), size: 0.07, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  const velocities = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  let cursor = 0;
  return {
    burst(at, count = 12) {
      for (let i = 0; i < count; i += 1) {
        const index = cursor;
        cursor = (cursor + 1) % COUNT;
        positions[index * 3] = at.x;
        positions[index * 3 + 1] = at.y;
        positions[index * 3 + 2] = at.z;
        const angle = Math.random() * Math.PI * 2;
        const up = Math.random() * 2.5 + 0.5;
        const speed = Math.random() * 2.5 + 1;
        velocities[index * 3] = Math.cos(angle) * speed;
        velocities[index * 3 + 1] = up;
        velocities[index * 3 + 2] = Math.sin(angle) * speed;
        life[index] = 0.35;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    step(dt) {
      let alive = false;
      for (let i = 0; i < COUNT; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        velocities[i * 3 + 1] -= 9 * dt;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        if (positions[i * 3 + 1] < 0.02) {
          positions[i * 3 + 1] = 0.02;
          velocities[i * 3 + 1] = 0;
        }
        alive = true;
      }
      points.visible = alive;
      geometry.attributes.position.needsUpdate = true;
    },
  };
}

export function createGrenades(scene, colliders, onExplode) {
  const items = [];
  const geometry = new THREE.SphereGeometry(0.09, 10, 8);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.4, metalness: 0.4, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.6 });
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();

  function throwGrenade(from, direction, speed = 13) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(from);
    scene.add(mesh);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.ember), 4, 4);
    mesh.add(light);
    items.push({ mesh, velocity: direction.clone().multiplyScalar(speed), fuse: GRENADE.fuse, bounced: 0 });
  }

  function step(dt) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      item.fuse -= dt;
      item.velocity.y -= 16 * dt;
      const next = tmp.copy(item.mesh.position).addScaledVector(item.velocity, dt);
      probe.min.set(next.x - 0.1, next.y - 0.1, next.z - 0.1);
      probe.max.set(next.x + 0.1, next.y + 0.1, next.z + 0.1);
      let hit = false;
      for (const collider of colliders) {
        if (!probe.intersectsBox(collider)) continue;
        hit = true;
        const center = new THREE.Vector3();
        collider.getCenter(center);
        if (Math.abs(next.x - center.x) > Math.abs(next.y - center.y) && Math.abs(next.x - center.x) > Math.abs(next.z - center.z)) item.velocity.x *= -0.45;
        else if (Math.abs(next.y - center.y) > Math.abs(next.z - center.z)) item.velocity.y = Math.abs(item.velocity.y) * 0.45;
        else item.velocity.z *= -0.45;
        item.velocity.multiplyScalar(0.7);
        item.bounced += 1;
        break;
      }
      if (!hit && next.y < 0.1) {
        next.y = 0.1;
        item.velocity.y = Math.abs(item.velocity.y) * 0.45;
        item.velocity.multiplyScalar(0.7);
        item.bounced += 1;
      }
      item.mesh.position.copy(next);
      if (item.fuse <= 0 || item.bounced > 6) {
        const at = item.mesh.position.clone();
        scene.remove(item.mesh);
        items.splice(i, 1);
        onExplode(at);
      }
    }
  }

  return { throwGrenade, step, count: () => items.length };
}
