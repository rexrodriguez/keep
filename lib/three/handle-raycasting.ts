import * as THREE from 'three';

export type HandleType = 'edge' | 'topFace' | 'bottomFace' | 'cornerTop' | 'cornerBottom';
export type EdgeType = 'front' | 'back' | 'left' | 'right';
export type AxisType = 'width' | 'depth';

export interface HandleHitResult {
  type: HandleType;
  edge?: EdgeType;
  cornerIndex?: 0 | 1 | 2 | 3;
  axis?: AxisType;
  direction?: 1 | -1;
  worldPosition: THREE.Vector3;
  localPosition: THREE.Vector3;
}

/**
 * Raycast from screen coordinates to detect handle intersections on the bounding box
 */
export function raycastHandles(
  screenX: number,
  screenY: number,
  camera: THREE.Camera,
  scene: THREE.Scene,
  canvasWidth: number,
  canvasHeight: number
): HandleHitResult | null {
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

  // Collect all handle meshes
  const handles: THREE.Object3D[] = [];
  boundingBox.traverse((child) => {
    if (child.name.startsWith('handle-')) {
      handles.push(child);
    }
  });

  if (handles.length === 0) {
    return null;
  }

  // Raycast against handle meshes
  const intersects = raycaster.intersectObjects(handles, false);

  if (intersects.length === 0) {
    return null;
  }

  const hit = intersects[0];
  const userData = hit.object.userData;

  // Get local position relative to bounding box
  const localPos = hit.point.clone();
  boundingBox.worldToLocal(localPos);

  return {
    type: userData.handleType,
    edge: userData.edge,
    cornerIndex: userData.cornerIndex,
    axis: userData.axis,
    direction: userData.direction,
    worldPosition: hit.point.clone(),
    localPosition: localPos,
  };
}

/**
 * Raycast from screen point to a horizontal floor plane at given Y height
 * Returns world position where ray intersects the plane
 */
export function raycastToFloorPlane(
  screenX: number,
  screenY: number,
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number,
  floorY: number
): THREE.Vector3 | null {
  // Convert screen coordinates to NDC
  const ndcX = (screenX / canvasWidth) * 2 - 1;
  const ndcY = -(screenY / canvasHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // Create a horizontal plane at floorY
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY);

  // Find intersection point
  const intersectionPoint = new THREE.Vector3();
  const ray = raycaster.ray;

  if (ray.intersectPlane(floorPlane, intersectionPoint)) {
    return intersectionPoint;
  }

  return null;
}

/**
 * Highlight a specific handle by making its indicator visible
 */
export function highlightHandle(
  scene: THREE.Scene,
  handleType: HandleType,
  handleId?: string
): void {
  const boundingBox = scene.getObjectByName('bounding-box');
  if (!boundingBox) return;

  boundingBox.traverse((child) => {
    if (child.name.startsWith('indicator-')) {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;

      // Check if this is the handle to highlight
      const isTarget =
        (handleType === 'edge' && child.name === `indicator-edge-${handleId}`) ||
        (handleType === 'topFace' && child.name === 'indicator-top-face') ||
        (handleType === 'bottomFace' && child.name === 'indicator-bottom-face') ||
        (handleType === 'cornerTop' && child.name === `indicator-corner-top-${handleId}`) ||
        (handleType === 'cornerBottom' && child.name === `indicator-corner-bottom-${handleId}`);

      if (isTarget) {
        material.opacity = 1.0;
        child.scale.setScalar(1.3);
      }
    }
  });
}

/**
 * Reset all handle indicators to their default state
 */
export function unhighlightAllHandles(scene: THREE.Scene): void {
  const boundingBox = scene.getObjectByName('bounding-box');
  if (!boundingBox) return;

  boundingBox.traverse((child) => {
    if (child.name.startsWith('indicator-')) {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.4;
      child.scale.setScalar(1.0);
    }
  });
}

/**
 * Calculate the axis delta for edge dragging
 * Projects the world-space movement onto the appropriate axis considering box rotation
 */
export function calculateAxisDelta(
  startWorldPos: THREE.Vector3,
  currentWorldPos: THREE.Vector3,
  axis: AxisType,
  direction: 1 | -1,
  rotationDeg: number
): number {
  // Get the movement delta
  const delta = currentWorldPos.clone().sub(startWorldPos);

  // Create rotation matrix from box rotation
  const rotationRad = (rotationDeg * Math.PI) / 180;

  // Determine the expansion axis in world space
  // Width axis is local X, Depth axis is local Z
  let axisVector: THREE.Vector3;
  if (axis === 'width') {
    // Local X axis rotated by box rotation
    axisVector = new THREE.Vector3(
      Math.cos(rotationRad),
      0,
      -Math.sin(rotationRad)
    );
  } else {
    // Local Z axis rotated by box rotation
    axisVector = new THREE.Vector3(
      Math.sin(rotationRad),
      0,
      Math.cos(rotationRad)
    );
  }

  // Project movement onto axis
  const projectedDelta = delta.dot(axisVector);

  // Apply direction (which edge is being dragged affects sign)
  return projectedDelta * direction;
}

/**
 * Convert screen Y delta to world height change
 * Uses approximate screen-to-world ratio based on camera distance
 */
export function screenDeltaToWorldHeight(
  deltaScreenY: number,
  camera: THREE.Camera,
  boxCenter: THREE.Vector3
): number {
  // Get camera's perspective to estimate scale
  const perspCamera = camera as THREE.PerspectiveCamera;

  // Distance from camera to box
  const cameraPos = new THREE.Vector3();
  camera.getWorldPosition(cameraPos);
  const distance = cameraPos.distanceTo(boxCenter);

  // Calculate approximate meters per pixel
  // At typical AR viewing distance (~1m), we want reasonable sensitivity
  const fovRad = (perspCamera.fov * Math.PI) / 180;
  const screenHeight = window.innerHeight;

  // Height of view frustum at box distance
  const frustumHeight = 2 * distance * Math.tan(fovRad / 2);

  // Meters per pixel
  const metersPerPixel = frustumHeight / screenHeight;

  // Invert Y because screen Y increases downward, but we want drag up = height increase
  return deltaScreenY * metersPerPixel;
}

/**
 * Calculate rotation angle from corner drag position relative to box center
 */
export function calculateRotationFromCornerDrag(
  startScreenPos: { x: number; y: number },
  currentScreenPos: { x: number; y: number },
  boxCenterScreen: { x: number; y: number },
  initialRotationDeg: number
): number {
  // Calculate angle from center to start position
  const startAngle = Math.atan2(
    startScreenPos.y - boxCenterScreen.y,
    startScreenPos.x - boxCenterScreen.x
  );

  // Calculate angle from center to current position
  const currentAngle = Math.atan2(
    currentScreenPos.y - boxCenterScreen.y,
    currentScreenPos.x - boxCenterScreen.x
  );

  // Calculate delta angle
  let deltaAngle = currentAngle - startAngle;

  // Convert to degrees
  let deltaDegrees = (deltaAngle * 180) / Math.PI;

  // Apply to initial rotation
  let newRotation = initialRotationDeg + deltaDegrees;

  // Normalize to 0-360
  while (newRotation < 0) newRotation += 360;
  while (newRotation >= 360) newRotation -= 360;

  return Math.round(newRotation);
}

/**
 * Project a 3D world position to 2D screen coordinates
 */
export function worldToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const projected = worldPos.clone().project(camera);

  return {
    x: ((projected.x + 1) / 2) * canvasWidth,
    y: ((-projected.y + 1) / 2) * canvasHeight,
  };
}
