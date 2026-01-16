import * as THREE from 'three';
import { MeasurementPoint } from '@/lib/types';

/**
 * Result of calculating new box from corner drag
 */
export interface CornerDragResult {
  newDragStart: MeasurementPoint;
  newDragEnd: MeasurementPoint;
  newRotation: number; // degrees
}

/**
 * Calculate new box dimensions and rotation from dragging a corner
 *
 * Corner indices (looking from above):
 * 0: Front-left  (-width/2, -depth/2)
 * 1: Front-right (+width/2, -depth/2)
 * 2: Back-right  (+width/2, +depth/2)
 * 3: Back-left   (-width/2, +depth/2)
 *
 * @param cornerIndex - Which corner is being dragged (0-3)
 * @param currentDragStart - Current anchor point (opposite corner from dragged)
 * @param currentDragEnd - Current dragged corner position
 * @param newPosition - New world position for the dragged corner
 * @param currentRotation - Current box rotation in degrees
 */
export function calculateCornerDrag(
  cornerIndex: number,
  currentDragStart: MeasurementPoint,
  currentDragEnd: MeasurementPoint,
  newPosition: THREE.Vector3,
  currentRotation: number
): CornerDragResult {
  // Get current box center and dimensions
  const p1 = currentDragStart.position;
  const p2 = currentDragEnd.position;

  const centerX = (p1.x + p2.x) / 2;
  const centerZ = (p1.z + p2.z) / 2;
  const centerY = Math.min(p1.y, p2.y);

  // Determine which corner is the anchor (opposite of dragged corner)
  const anchorCornerIndex = (cornerIndex + 2) % 4;

  // Get anchor corner position in world space
  // We need to transform from local box space to world space
  const currentWidth = Math.abs(p2.x - p1.x);
  const currentDepth = Math.abs(p2.z - p1.z);

  // Calculate anchor position (opposite corner)
  const rotRad = (currentRotation * Math.PI) / 180;
  const cosRot = Math.cos(rotRad);
  const sinRot = Math.sin(rotRad);

  // Local positions of corners before rotation
  const localCorners = [
    new THREE.Vector3(-currentWidth / 2, 0, -currentDepth / 2), // 0: Front-left
    new THREE.Vector3(currentWidth / 2, 0, -currentDepth / 2),  // 1: Front-right
    new THREE.Vector3(currentWidth / 2, 0, currentDepth / 2),   // 2: Back-right
    new THREE.Vector3(-currentWidth / 2, 0, currentDepth / 2),  // 3: Back-left
  ];

  // Transform anchor corner to world space
  const anchorLocal = localCorners[anchorCornerIndex];
  const anchorWorld = new THREE.Vector3(
    centerX + anchorLocal.x * cosRot - anchorLocal.z * sinRot,
    centerY,
    centerZ + anchorLocal.x * sinRot + anchorLocal.z * cosRot
  );

  // New drag vector from anchor to new position
  const dragVector = new THREE.Vector3(
    newPosition.x - anchorWorld.x,
    0,
    newPosition.z - anchorWorld.z
  );

  // Calculate new rotation from drag vector
  // Align the box so that the drag direction becomes one of the edges
  let newRotation = Math.atan2(dragVector.z, dragVector.x) * (180 / Math.PI);

  // Adjust rotation based on which corner is being dragged
  // We want the box to align with the drag direction
  const rotationOffsets = [
    45,   // Corner 0: Front-left
    -45,  // Corner 1: Front-right
    -135, // Corner 2: Back-right
    135,  // Corner 3: Back-left
  ];

  newRotation -= rotationOffsets[cornerIndex];

  // Normalize to 0-360
  while (newRotation < 0) newRotation += 360;
  while (newRotation >= 360) newRotation -= 360;

  // Calculate new dimensions
  // The diagonal length is the distance from anchor to new position
  const diagonalLength = dragVector.length();

  // Assuming square-ish box, width and depth are diagonal / sqrt(2)
  // But we want to preserve the aspect ratio if possible
  const aspectRatio = currentWidth / currentDepth;

  // For now, make it a square and let user adjust with sliders
  const newWidth = diagonalLength / Math.sqrt(2);
  const newDepth = diagonalLength / Math.sqrt(2);

  // Calculate new dragStart and dragEnd
  // Anchor stays the same, dragged corner moves
  const newDragStart: MeasurementPoint = {
    ...currentDragStart,
    position: anchorWorld.clone(),
  };

  const newDragEnd: MeasurementPoint = {
    ...currentDragEnd,
    position: newPosition.clone(),
    timestamp: Date.now(),
  };

  return {
    newDragStart,
    newDragEnd,
    newRotation,
  };
}

/**
 * Simpler approach: Only one draggable corner (dragEnd)
 * dragStart is always the anchor point
 */
export function calculateSimpleCornerDrag(
  cornerIndex: number,
  currentDragStart: MeasurementPoint,
  currentDragEnd: MeasurementPoint,
  newPosition: THREE.Vector3,
  currentRotation: number
): CornerDragResult {
  // dragStart is always the anchor
  const anchorPos = currentDragStart.position;
  const draggedPos = newPosition.clone();

  // Calculate rotation from the diagonal between anchor and new position
  const diagonal = new THREE.Vector3(
    draggedPos.x - anchorPos.x,
    0,
    draggedPos.z - anchorPos.z
  );

  // Rotation is based on the diagonal direction
  const angle = Math.atan2(diagonal.z, diagonal.x) * (180 / Math.PI);

  // Adjust by 45 degrees since diagonal is 45° to box edges
  let newRotation = angle - 45;

  // Normalize to 0-360
  while (newRotation < 0) newRotation += 360;
  while (newRotation >= 360) newRotation -= 360;

  return {
    newDragStart: currentDragStart, // Anchor stays the same
    newDragEnd: {
      ...currentDragEnd,
      position: draggedPos,
      timestamp: Date.now(),
    },
    newRotation,
  };
}
