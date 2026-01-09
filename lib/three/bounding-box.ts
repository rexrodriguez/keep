import * as THREE from 'three';
import { MeasurementPoint, Rectangle3D } from '@/lib/types';
import { fitRectangleToPoints } from '@/lib/measurement/geometry';

/**
 * Create a translucent bounding box visualization
 */
export function createBoundingBox(
  width: number,
  depth: number,
  height: number,
  center: THREE.Vector3,
  rotation: THREE.Quaternion
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bounding-box';

  // Create box geometry
  const geometry = new THREE.BoxGeometry(width, height, depth);

  // Translucent fill
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Wireframe edges
  const edgesGeometry = new THREE.EdgesGeometry(geometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x4488ff,
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  group.add(edges);

  // Position and rotate
  group.position.copy(center);
  group.position.y += height / 2; // Box is centered, so lift by half height
  group.quaternion.copy(rotation);

  return group;
}

/**
 * Update bounding box from measurement points
 */
export function updateBoundingBoxFromPoints(
  scene: THREE.Scene,
  basePoints: MeasurementPoint[],
  heightPoint: MeasurementPoint | null
): THREE.Group | null {
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

  // Need all 4 base points and height to show full box
  if (basePoints.length < 4 || !heightPoint) {
    return null;
  }

  // Fit rectangle to base points
  const positions = basePoints.map((p) => p.position);
  const rectangle = fitRectangleToPoints(positions);

  // Calculate height from base plane to height point
  const baseCenterY =
    positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  const height = Math.abs(heightPoint.position.y - baseCenterY);

  // Create rotation quaternion from rectangle orientation
  const rotation = new THREE.Quaternion();
  const rotationMatrix = new THREE.Matrix4();
  rotationMatrix.makeBasis(
    rectangle.widthDirection,
    rectangle.normal,
    rectangle.depthDirection
  );
  rotation.setFromRotationMatrix(rotationMatrix);

  // Create and add bounding box
  const box = createBoundingBox(
    rectangle.width,
    rectangle.depth,
    height,
    rectangle.center,
    rotation
  );

  scene.add(box);
  return box;
}

/**
 * Create a partial visualization during measurement
 * Shows progress as points are added
 */
export function createPartialVisualization(
  basePoints: MeasurementPoint[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'partial-viz';

  if (basePoints.length < 2) return group;

  const positions = basePoints.map((p) => p.position);

  // Create filled polygon for floor area
  if (positions.length >= 3) {
    const shape = new THREE.Shape();
    shape.moveTo(positions[0].x, positions[0].z);
    for (let i = 1; i < positions.length; i++) {
      shape.lineTo(positions[i].x, positions[i].z);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = positions[0].y + 0.001;
    group.add(mesh);
  }

  return group;
}
