import * as THREE from 'three';
import { MeasurementPoint } from '@/lib/types';

/**
 * Create a bounding box with explicit dimensions at a given center position.
 * @param centerX - World X coordinate of box center
 * @param centerY - World Y coordinate of box center (middle height)
 * @param centerZ - World Z coordinate of box center
 * @param width - Box width (local X dimension)
 * @param height - Box height (local Y dimension)
 * @param depth - Box depth (local Z dimension)
 * @param rotation_deg - Rotation around Y axis in degrees
 */
function createBoxAtCenter(
  centerX: number,
  centerY: number,
  centerZ: number,
  width: number,
  height: number,
  depth: number,
  rotation_deg: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bounding-box';

  // Create box geometry with explicit dimensions
  const geometry = new THREE.BoxGeometry(width, height, depth);

  // Translucent fill - blue with low opacity
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Wireframe edges - brighter blue
  const edgesGeometry = new THREE.EdgesGeometry(geometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  group.add(edges);

  // Add single corner handle at the far corner
  const cornerRadius = 0.04; // 4cm sphere for better visibility
  const cornerGeometry = new THREE.SphereGeometry(cornerRadius, 16, 16);
  const cornerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa00, // Orange handle
    transparent: true,
    opacity: 0.9,
  });

  const dragEndLocal = new THREE.Vector3(
    width / 2,
    -height / 2,
    depth / 2
  );

  const cornerMesh = new THREE.Mesh(cornerGeometry, cornerMaterial);
  cornerMesh.position.copy(dragEndLocal);
  cornerMesh.name = 'corner-handle';
  cornerMesh.userData = { isCornerHandle: true, cornerIndex: 0 };
  group.add(cornerMesh);

  // Position the group at the center
  group.position.set(centerX, centerY, centerZ);

  // Apply rotation around Y axis
  group.rotation.y = (rotation_deg * Math.PI) / 180;

  return group;
}

/**
 * Create or update a bounding box from two floor points and a height value.
 * The box is positioned between the two floor points and extends upward.
 * @param rotation_deg - Optional rotation in degrees (applied around Y axis)
 */
export function createFloorBoundingBox(
  floorPoint1: MeasurementPoint,
  floorPoint2: MeasurementPoint,
  height: number,
  rotation_deg: number = 0
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bounding-box';

  const p1 = floorPoint1.position;
  const p2 = floorPoint2.position;

  // Calculate dimensions (absolute values for size)
  const width = Math.abs(p2.x - p1.x);
  const depth = Math.abs(p2.z - p1.z);

  // Calculate center position (midpoint of floor diagonal, raised by half height)
  const centerX = (p1.x + p2.x) / 2;
  const centerY = Math.min(p1.y, p2.y) + height / 2;
  const centerZ = (p1.z + p2.z) / 2;

  // Create box geometry - axis-aligned for now
  const geometry = new THREE.BoxGeometry(width, height, depth);

  // Translucent fill - blue with low opacity
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Wireframe edges - brighter blue
  const edgesGeometry = new THREE.EdgesGeometry(geometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  group.add(edges);

  // Add single corner handle at the dragEnd position (bottom corner opposite to dragStart)
  // This represents the second point that was dragged
  const cornerRadius = 0.04; // 4cm sphere for better visibility
  const cornerGeometry = new THREE.SphereGeometry(cornerRadius, 16, 16);
  const cornerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa00, // Orange handle
    transparent: true,
    opacity: 0.9,
  });

  // Corner handle is always at the local (+width/2, +depth/2) position
  // This ensures it stays in the same corner regardless of rotation
  const dragEndLocal = new THREE.Vector3(
    width / 2,   // Always positive (far corner in local space)
    -height / 2,
    depth / 2    // Always positive (far corner in local space)
  );

  const cornerMesh = new THREE.Mesh(cornerGeometry, cornerMaterial);
  cornerMesh.position.copy(dragEndLocal);
  cornerMesh.name = 'corner-handle';
  cornerMesh.userData = { isCornerHandle: true, cornerIndex: 0 }; // Always index 0 since we only have one
  group.add(cornerMesh);

  // Position the group at the center
  group.position.set(centerX, centerY, centerZ);

  // Apply rotation around Y axis (yaw)
  // Convert degrees to radians
  group.rotation.y = (rotation_deg * Math.PI) / 180;

  return group;
}

/**
 * Update or create the bounding box in the scene
 * @param overrideWidth - Optional override for width (used in LLM mode when user adjusts sliders)
 * @param overrideDepth - Optional override for depth (used in LLM mode when user adjusts sliders)
 * @param rotation_deg - Optional rotation in degrees (default 0)
 */
export function updateBoundingBox(
  scene: THREE.Scene,
  floorPoint1: MeasurementPoint | null,
  floorPoint2: MeasurementPoint | null,
  height: number,
  overrideWidth?: number,
  overrideDepth?: number,
  rotation_deg: number = 0
): void {
  // Remove existing bounding box
  const existing = scene.getObjectByName('bounding-box');
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

  // Only show box when we have both floor points
  if (!floorPoint1 || !floorPoint2) {
    return;
  }

  // Ensure minimum dimensions for visibility
  const minDim = 0.02; // 2cm minimum
  const p1 = floorPoint1.position;
  const p2 = floorPoint2.position;

  // When we have explicit width/depth overrides, use the new createBoxAtCenter function
  // This properly handles rotation by using explicit dimensions instead of calculating from points
  if (overrideWidth !== undefined && overrideDepth !== undefined) {
    const actualWidth = Math.max(overrideWidth, minDim);
    const actualDepth = Math.max(overrideDepth, minDim);
    const actualHeight = Math.max(height, minDim);

    // Calculate center of current box
    const centerX = (p1.x + p2.x) / 2;
    const centerY = Math.min(p1.y, p2.y) + actualHeight / 2;
    const centerZ = (p1.z + p2.z) / 2;

    const box = createBoxAtCenter(
      centerX,
      centerY,
      centerZ,
      actualWidth,
      actualHeight,
      actualDepth,
      rotation_deg
    );
    scene.add(box);
    return;
  }

  // Manual drag mode - preserve actual drag direction
  const deltaX = p2.x - p1.x;
  const deltaZ = p2.z - p1.z;
  const actualWidth = Math.max(Math.abs(deltaX), minDim);
  const actualDepth = Math.max(Math.abs(deltaZ), minDim);
  const actualHeight = Math.max(height, minDim);

  // Preserve the sign/direction of the drag
  const adjustedP1: MeasurementPoint = {
    ...floorPoint1,
    position: p1.clone(),
  };
  const adjustedP2: MeasurementPoint = {
    ...floorPoint2,
    position: new THREE.Vector3(
      p1.x + (Math.sign(deltaX) * actualWidth),
      p2.y,
      p1.z + (Math.sign(deltaZ) * actualDepth)
    ),
  };

  const box = createFloorBoundingBox(adjustedP1, adjustedP2, actualHeight, rotation_deg);
  scene.add(box);
}

/**
 * Dispose of the bounding box
 */
export function disposeBoundingBox(scene: THREE.Scene): void {
  const existing = scene.getObjectByName('bounding-box');
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
