import * as THREE from 'three';

const GRID_NAME = 'floor-grid';

/**
 * Add a floor reference grid to the scene at the locked floor position.
 * 1m x 1m grid with 10cm line spacing, cyan with transparency.
 * Center ring highlights the tap point.
 */
export function addFloorGrid(
  scene: THREE.Scene,
  position: THREE.Vector3,
  floorY: number
): void {
  // Remove existing grid first
  disposeFloorGrid(scene);

  const group = new THREE.Group();
  group.name = GRID_NAME;

  const CYAN = 0x22d3ee;
  const SIZE = 1.0;     // 1m total
  const HALF = SIZE / 2;
  const STEP = 0.1;     // 10cm spacing

  // Grid lines
  const lineMat = new THREE.LineBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: 0.3,
  });

  // Lines along X (varying Z)
  for (let z = -HALF; z <= HALF + 0.001; z += STEP) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HALF, 0, z),
      new THREE.Vector3(HALF, 0, z),
    ]);
    const line = new THREE.Line(geo, lineMat);
    group.add(line);
  }

  // Lines along Z (varying X)
  for (let x = -HALF; x <= HALF + 0.001; x += STEP) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, -HALF),
      new THREE.Vector3(x, 0, HALF),
    ]);
    const line = new THREE.Line(geo, lineMat);
    group.add(line);
  }

  // Center ring highlight at tap point
  const ringGeo = new THREE.RingGeometry(0.04, 0.06, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: CYAN,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.001; // Slightly above grid to prevent z-fighting
  group.add(ring);

  // Position grid centered on the tap point, at floor Y
  group.position.set(position.x, floorY, position.z);

  scene.add(group);
}

/**
 * Remove and dispose the floor grid from the scene
 */
export function disposeFloorGrid(scene: THREE.Scene): void {
  const grid = scene.getObjectByName(GRID_NAME);
  if (grid) {
    scene.remove(grid);
    grid.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      } else if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
