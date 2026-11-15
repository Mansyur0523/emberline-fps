// The map: Foundry Yard, a 46 x 36 m industrial yard at dusk. Ember (the
// player's team) spawns south, Ash spawns north. Site A, the Furnace, sits
// north-west; site B, the Crane, north-east; three lanes join them: A-long
// down the west wall, mid past the furnace block, B-long down the east wall.
// Every box is a collider for movement and a surface a bullet stops on.
// The waypoint graph is what the bots walk: nodes at spawns, corners and
// sites, edges along the lanes, so no route ever crosses solid geometry.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: id -> { x, z, next: [ids] }. Bots path with BFS over it.
export const WAYPOINTS = {
  emberSpawn: { x: 0, z: 14, next: ['emberLeft', 'emberRight', 'midSouth'] },
  emberLeft: { x: -9, z: 11, next: ['emberSpawn', 'aLong'] },
  emberRight: { x: 9, z: 11, next: ['emberSpawn', 'bLong'] },
  midSouth: { x: 0, z: 7, next: ['emberSpawn', 'mid'] },
  mid: { x: 0, z: 0, next: ['midSouth', 'midNorth', 'aShort', 'bShort'] },
  midNorth: { x: 0, z: -6, next: ['mid', 'aCorner', 'bCorner', 'ashSpawn'] },
  aShort: { x: -9, z: -4, next: ['mid', 'aCorner'] },
  bShort: { x: 9, z: -4, next: ['mid', 'bCorner'] },
  aCorner: { x: -8, z: -11, next: ['aShort', 'midNorth', 'aSite', 'ashSpawn'] },
  bCorner: { x: 8, z: -11, next: ['bShort', 'midNorth', 'bSite', 'ashSpawn'] },
  aLong: { x: -17, z: 5, next: ['emberLeft', 'aLongMid'] },
  aLongMid: { x: -19, z: -4, next: ['aLong', 'aSite'] },
  bLong: { x: 17, z: 5, next: ['emberRight', 'bLongMid'] },
  bLongMid: { x: 19, z: -4, next: ['bLong', 'bSite'] },
  aSite: { x: -15, z: -12, next: ['aLongMid', 'aCorner'] },
  bSite: { x: 15, z: -12, next: ['bLongMid', 'bCorner'] },
  ashSpawn: { x: 0, z: -14.5, next: ['midNorth', 'aCorner', 'bCorner'] },
};

export function findPath(from, to) {
  if (from === to) return [to];
  const cameFrom = { [from]: null };
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of WAYPOINTS[current].next) {
      if (!(next in cameFrom)) {
        cameFrom[next] = current;
        if (next === to) {
          const path = [to];
          let node = to;
          while (cameFrom[node] !== null) {
            node = cameFrom[node];
            path.unshift(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [to];
}

export function nearestWaypoint(x, z) {
  let best = 'mid';
  let bestDistance = Infinity;
  for (const [id, node] of Object.entries(WAYPOINTS)) {
    const distance = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of ['concrete', 'rust', 'steel', 'surface', 'hairline', 'canvas', 'ember', 'foliage']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.45 : 0.92,
      metalness: name === 'steel' ? 0.5 : 0.03,
    });
  }
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ember),
    emissive: new THREE.Color(PALETTE.ember),
    emissiveIntensity: 2.2,
    roughness: 0.6,
  });
  const siteMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.site),
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor and the four outer walls, 5 m high.
  box(46.4, 0.4, 36.4, 0, -0.2, 0, 'concrete');
  box(0.4, 5, 36.4, -23.2, 2.5, 0, 'surface');
  box(0.4, 5, 36.4, 23.2, 2.5, 0, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, -18.2, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, 18.2, 'surface');

  // Site A, the Furnace: a brick furnace wall with a glowing mouth and a chimney.
  box(7, 4.4, 2.4, -16, 2.2, -16.6, 'rust');
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), glowMaterial);
  mouth.position.set(-16, 1.1, -15.35);
  group.add(mouth);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6, 10), materials.steel);
  chimney.position.set(-18.5, 6.5, -16.6);
  chimney.castShadow = true;
  group.add(chimney);
  colliders.push(new THREE.Box3().setFromObject(chimney));

  // Site B, the Crane: two legs and a jib, with a hanging hook block.
  box(0.9, 6.5, 0.9, 13.2, 3.25, -15.5, 'steel');
  box(0.9, 6.5, 0.9, 17.6, 3.25, -15.5, 'steel');
  box(7.5, 0.8, 0.9, 15.4, 6.4, -15.5, 'steel');
  box(0.7, 1.1, 0.7, 15.4, 4.6, -15.5, 'rust');

  // The furnace block in mid: the yard's centre piece, forcing mid fights around it.
  box(3, 3.4, 3, 4.5, 1.7, -2, 'rust');
  box(3.4, 0.5, 3.4, 4.5, 3.65, -2, 'steel');

  // Shipping containers and crates: the lanes' cover.
  box(4.2, 2.4, 2, -12, 1.2, 3, 'steel');
  box(4.2, 2.4, 2, 12, 1.2, -6, 'steel');
  box(2.4, 2.4, 2, -19.5, 1.2, 1, 'rust');
  box(2.4, 2.4, 2, 19.5, 1.2, -8, 'rust');
  box(1.2, 1.1, 1.2, -6, 0.55, 8, 'hairline');
  box(1.2, 1.1, 1.2, 6, 0.55, 8, 'hairline');
  box(1.2, 1.1, 1.2, -4, 0.55, -8, 'hairline');
  box(1.2, 1.1, 1.2, 5, 0.55, -8, 'hairline');
  box(1.2, 1.1, 3.6, -10, 0.55, -2, 'hairline');
  box(1.2, 1.1, 3.6, 10, 0.55, -2, 'hairline');
  box(3.6, 1.1, 1.2, -14, 0.55, 8, 'hairline');
  box(3.6, 1.1, 1.2, 14, 0.55, 8, 'hairline');
  box(1.6, 0.7, 1.6, -7.5, 0.35, 12.5, 'hairline');
  box(1.6, 0.7, 1.6, 7.5, 0.35, 12.5, 'hairline');
  // Raised platform at the back of mid, a perch over the yard.
  box(5, 0.5, 2.4, -6, 0.25, -13.5, 'surface');
  box(0.9, 1.4, 0.9, -8.2, 0.7, -12.6, 'hairline');

  // Site markers: flat glowing rings on the floor where the bomb goes.
  const sites = {};
  for (const [name, x, z] of [['A', -15, -12], ['B', 15, -12]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.3, 32), siteMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    group.add(ring);
    sites[name] = {
      center: new THREE.Vector3(x, 0, z),
      box: new THREE.Box3(new THREE.Vector3(x - 2.4, 0, z - 2.4), new THREE.Vector3(x + 2.4, 3, z + 2.4)),
      ring,
    };
  }

  // Light: a low dusk sun from the south-west, a cool fill from the north,
  // a warm hemisphere, and the furnace mouth's own orange glow at site A.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7a68'), new THREE.Color(PALETTE.canvas), 1.05);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.4);
  sun.position.set(-14, 16, 18);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#5a7a9a'), 0.7);
  fill.position.set(10, 12, -16);
  scene.add(fill);

  const furnaceGlow = new THREE.PointLight(new THREE.Color(PALETTE.ember), 26, 14, 1.6);
  furnaceGlow.position.set(-16, 1.4, -14.4);
  scene.add(furnaceGlow);

  return { colliders, shootables, group, sites, furnaceGlow };
}
