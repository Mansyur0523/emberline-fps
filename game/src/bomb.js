// The bomb: carried by the player (or by an Ember bot if the player falls),
// dropped where its carrier dies, planted at a site on a channel, and
// defused by the Ash bots on a channel. A planted bomb ticks for 35 seconds
// with beeps that quicken, then explodes. The module owns the state machine
// and the bomb mesh; main.js owns the channels and the round consequences.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const BOMB_TIMER = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.18, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1a17'), roughness: 0.5, metalness: 0.4 }),
  );
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }),
  );
  light.position.set(0.12, 0.11, 0);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.6 }),
  );
  antenna.position.set(-0.12, 0.16, 0);
  group.add(body, light, antenna);
  group.visible = false;
  scene.add(group);

  const state = {
    status: 'carried', // carried | dropped | planted | exploded | defused
    carrier: 'player', // 'player' | bot object | null
    site: null,
    position: new THREE.Vector3(),
    timer: BOMB_TIMER,
    blink: 0,
  };

  function showAt(position) {
    group.position.copy(position);
    group.position.y = 0.12;
    group.visible = true;
  }

  return {
    state,
    reset(carrier = 'player') {
      state.status = 'carried';
      state.carrier = carrier;
      state.site = null;
      state.timer = BOMB_TIMER;
      state.blink = 0;
      group.visible = false;
    },
    dropAt(position) {
      state.status = 'dropped';
      state.carrier = null;
      state.position.copy(position);
      state.position.y = 0;
      showAt(state.position);
    },
    plant(site, position) {
      state.status = 'planted';
      state.site = site;
      state.carrier = null;
      state.position.copy(position);
      state.position.y = 0;
      state.timer = BOMB_TIMER;
      showAt(state.position);
    },
    defuse() {
      state.status = 'defused';
      group.visible = false;
    },
    explode() {
      state.status = 'exploded';
      group.visible = false;
    },
    step(dt) {
      if (state.status !== 'planted') return;
      state.timer -= dt;
      state.blink += dt;
      const interval = state.timer > 20 ? 1 : state.timer > 10 ? 0.5 : 0.25;
      light.visible = (state.blink % interval) < interval * 0.5;
    },
    beepInterval() {
      if (state.status !== 'planted') return 0;
      if (state.timer > 20) return 1;
      if (state.timer > 10) return 0.5;
      return 0.25;
    },
  };
}
