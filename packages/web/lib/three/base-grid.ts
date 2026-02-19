import * as THREE from 'three';

const GRID_NAME = 'base-grid';

/**
 * Add a wireframe grid to the scene showing the established base plane.
 * 2m × 2m grid, 10 divisions (20cm cells), semi-transparent green.
 */
export function addBaseGrid(
  scene: THREE.Scene,
  position: THREE.Vector3,
): void {
  removeBaseGrid(scene);

  const grid = new THREE.GridHelper(2, 10, 0x4ade80, 0x4ade80);
  grid.name = GRID_NAME;
  grid.position.copy(position);
  grid.material = new THREE.LineBasicMaterial({
    color: 0x4ade80,
    transparent: true,
    opacity: 0.5,
    linewidth: 2,
  });
  scene.add(grid);
}

/**
 * Remove the base grid from the scene.
 */
export function removeBaseGrid(scene: THREE.Scene): void {
  const existing = scene.getObjectByName(GRID_NAME);
  if (existing) {
    scene.remove(existing);
    existing.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
