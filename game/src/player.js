// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// as a box against the world's colliders one axis at a time, so a wall never
// swallows the player. The same mover drives the bots: createMover builds the
// shared axis-separated resolver, and the player wraps it with keyboard input.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.02;
export const WALK_SPEED = 5.4;
export const CROUCH_SPEED = 2.5;
export const GROUND_ACCEL = 42;
export const AIR_ACCEL = 9;
export const FRICTION = 9;
export const GRAVITY = 20;
export const JUMP_SPEED = 6.4;

export function createMover(colliders, position) {
  const probe = new THREE.Box3();
  const mover = {
    position: position.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  function move(dt, wishX, wishZ, speed, wantJump, wantCrouch) {
    const crouching = wantCrouch;
    if (crouching && !mover.crouching) {
      mover.crouching = true;
      mover.height = CROUCH_HEIGHT;
    } else if (!crouching && mover.crouching && !overlaps(mover.position.x, mover.position.y, mover.position.z, STAND_HEIGHT, 0.02)) {
      mover.crouching = false;
      mover.height = STAND_HEIGHT;
    }
    const eyeTarget = mover.crouching ? CROUCH_EYE : STAND_EYE;
    mover.eye += (eyeTarget - mover.eye) * Math.min(1, dt * 12);

    const moveSpeed = mover.crouching ? CROUCH_SPEED : speed;
    const blend = Math.min(1, (mover.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / moveSpeed);
    mover.velocity.x += (wishX * moveSpeed - mover.velocity.x) * blend;
    mover.velocity.z += (wishZ * moveSpeed - mover.velocity.z) * blend;
    if (mover.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      mover.velocity.x *= damp;
      mover.velocity.z *= damp;
    }

    if (wantJump && mover.onGround) {
      mover.velocity.y = JUMP_SPEED;
      mover.onGround = false;
    }
    mover.velocity.y -= GRAVITY * dt;

    const nextX = mover.position.x + mover.velocity.x * dt;
    if (!overlaps(nextX, mover.position.y, mover.position.z, mover.height, 0.04)) mover.position.x = nextX;
    else mover.velocity.x = 0;
    const nextZ = mover.position.z + mover.velocity.z * dt;
    if (!overlaps(mover.position.x, mover.position.y, nextZ, mover.height, 0.04)) mover.position.z = nextZ;
    else mover.velocity.z = 0;

    mover.position.y += mover.velocity.y * dt;
    mover.onGround = false;
    const hit = overlaps(mover.position.x, mover.position.y, mover.position.z, mover.height, 0);
    if (hit && mover.velocity.y <= 0) {
      mover.position.y = hit.max.y;
      mover.velocity.y = 0;
      mover.onGround = true;
    } else if (hit) {
      mover.position.y = hit.min.y - mover.height;
      mover.velocity.y = 0;
    }
    if (mover.position.y < 0) {
      mover.position.y = 0;
      mover.velocity.y = 0;
      mover.onGround = true;
    }
    mover.velocity.y = Math.max(-30, mover.velocity.y);
  }

  return { mover, overlaps, move };
}

export function createPlayer(colliders) {
  const { mover, move } = createMover(colliders, new THREE.Vector3(0, 0, 14));
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    mover.yaw -= dx * sensitivity;
    mover.pitch = Math.max(-1.45, Math.min(1.45, mover.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    mover.pitch = Math.min(1.45, mover.pitch + pitchKick);
    mover.yaw += yawKick;
  }

  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(mover.yaw);
      const cos = Math.cos(mover.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    move(dt, wish.x, wish.z, WALK_SPEED, keys.has('Space'), crouch);
  }

  return {
    state: mover,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(mover.velocity.x, mover.velocity.z);
    },
  };
}
