import * as THREE from 'three';
import { MeasurementPoint } from '@/lib/types';

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

  // In LLM mode with overrides, use positive offsets from p1 as anchor
  // Otherwise preserve the actual drag direction
  if (overrideWidth !== undefined && overrideDepth !== undefined) {
    const actualWidth = Math.max(overrideWidth, minDim);
    const actualDepth = Math.max(overrideDepth, minDim);
    const actualHeight = Math.max(height, minDim);

    // Create adjusted points - use p1 as anchor with positive offsets
    const adjustedP1: MeasurementPoint = {
      ...floorPoint1,
      position: p1.clone(),
    };
    const adjustedP2: MeasurementPoint = {
      ...floorPoint2,
      position: new THREE.Vector3(
        p1.x + actualWidth,
        p2.y,
        p1.z + actualDepth
      ),
    };

    const box = createFloorBoundingBox(adjustedP1, adjustedP2, actualHeight, rotation_deg);
    scene.add(box);
    return;
  }

  // Manual drag mode - auto-orient box along drag direction
  const deltaX = p2.x - p1.x;
  const deltaZ = p2.z - p1.z;

  // Calculate drag distance and angle
  const dragDistance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  const dragAngle = Math.atan2(deltaZ, deltaX) * (180 / Math.PI); // Convert to degrees

  // The drag defines one dimension (length), use a default for the perpendicular dimension (width)
  const actualLength = Math.max(dragDistance, minDim);
  const actualWidth = Math.max(dragDistance * 0.5, minDim); // Default width is 50% of length
  const actualHeight = Math.max(height, minDim);

  // Create a box that spans from p1 to p2 as the "length" dimension
  // Width is perpendicular to the drag direction
  const centerX = (p1.x + p2.x) / 2;
  const centerZ = (p1.z + p2.z) / 2;

  // Create virtual points for the box dimensions
  // The "length" is along the drag direction, "width" is perpendicular
  const adjustedP1: MeasurementPoint = {
    ...floorPoint1,
    position: new THREE.Vector3(centerX - actualLength / 2, p1.y, centerZ),
  };
  const adjustedP2: MeasurementPoint = {
    ...floorPoint2,
    position: new THREE.Vector3(centerX + actualLength / 2, p2.y, centerZ + actualWidth),
  };

  // Apply auto-rotation from drag direction + manual rotation adjustment
  const totalRotation = dragAngle + rotation_deg;

  const box = createFloorBoundingBox(adjustedP1, adjustedP2, actualHeight, totalRotation);
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
