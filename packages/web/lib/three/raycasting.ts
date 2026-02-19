import * as THREE from 'three';

export interface CornerHitResult {
  cornerIndex: number;
  worldPosition: THREE.Vector3;
  object: THREE.Object3D;
}

/**
 * Raycast from screen coordinates to detect corner handle intersections
 */
export function raycastCornerHandles(
  screenX: number,
  screenY: number,
  camera: THREE.Camera,
  scene: THREE.Scene,
  canvasWidth: number,
  canvasHeight: number
): CornerHitResult | null {
  // Convert screen coordinates to normalized device coordinates (-1 to +1)
  const ndcX = (screenX / canvasWidth) * 2 - 1;
  const ndcY = -(screenY / canvasHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // Find the bounding box group
  const boundingBox = scene.getObjectByName('bounding-box');
  if (!boundingBox) {
    return null;
  }

  // Get all corner handles
  const corners: THREE.Object3D[] = [];
  boundingBox.traverse((child) => {
    if (child.userData.isCornerHandle) {
      corners.push(child);
    }
  });

  if (corners.length === 0) {
    return null;
  }

  // Raycast against corner handles
  const intersects = raycaster.intersectObjects(corners, false);

  if (intersects.length > 0) {
    const hit = intersects[0];
    const cornerIndex = hit.object.userData.cornerIndex;

    return {
      cornerIndex,
      worldPosition: hit.point.clone(),
      object: hit.object,
    };
  }

  return null;
}

/**
 * Get world position of a corner handle by index
 */
export function getCornerWorldPosition(
  scene: THREE.Scene,
  cornerIndex: number
): THREE.Vector3 | null {
  const boundingBox = scene.getObjectByName('bounding-box');
  if (!boundingBox) {
    return null;
  }

  let cornerMesh: THREE.Object3D | undefined;
  boundingBox.traverse((child) => {
    if (child.userData.isCornerHandle && child.userData.cornerIndex === cornerIndex) {
      cornerMesh = child;
    }
  });

  if (!cornerMesh) {
    return null;
  }

  const worldPos = new THREE.Vector3();
  cornerMesh.getWorldPosition(worldPos);
  return worldPos;
}
