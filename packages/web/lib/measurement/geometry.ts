import * as THREE from 'three';
import { Rectangle3D, BasePlane } from '@/lib/types';

/**
 * Fit a rectangle to 4 imperfect points
 * Uses the first edge as width direction, projects points onto axes
 */
export function fitRectangleToPoints(points: THREE.Vector3[]): Rectangle3D {
  if (points.length < 4) {
    throw new Error('Need 4 points to fit a rectangle');
  }

  // Calculate centroid
  const center = new THREE.Vector3();
  points.forEach((p) => center.add(p));
  center.divideScalar(points.length);

  // Use P1→P2 as width direction
  const widthDirection = new THREE.Vector3()
    .subVectors(points[1], points[0])
    .normalize();

  // Calculate plane normal from first 3 points
  const v1 = new THREE.Vector3().subVectors(points[1], points[0]);
  const v2 = new THREE.Vector3().subVectors(points[2], points[0]);
  const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

  // Ensure normal points up (positive Y)
  if (normal.y < 0) {
    normal.negate();
  }

  // Depth direction is perpendicular to width, in the plane
  const depthDirection = new THREE.Vector3()
    .crossVectors(normal, widthDirection)
    .normalize();

  // Project all points onto width/depth axes to find extents
  let minWidth = Infinity,
    maxWidth = -Infinity;
  let minDepth = Infinity,
    maxDepth = -Infinity;

  points.forEach((p) => {
    const relative = new THREE.Vector3().subVectors(p, center);
    const widthProj = relative.dot(widthDirection);
    const depthProj = relative.dot(depthDirection);

    minWidth = Math.min(minWidth, widthProj);
    maxWidth = Math.max(maxWidth, widthProj);
    minDepth = Math.min(minDepth, depthProj);
    maxDepth = Math.max(maxDepth, depthProj);
  });

  const width = maxWidth - minWidth;
  const depth = maxDepth - minDepth;

  // Adjust center to be at the middle of the fitted rectangle
  const widthOffset = (maxWidth + minWidth) / 2;
  const depthOffset = (maxDepth + minDepth) / 2;
  center.add(widthDirection.clone().multiplyScalar(widthOffset));
  center.add(depthDirection.clone().multiplyScalar(depthOffset));

  return {
    center,
    width,
    depth,
    widthDirection,
    depthDirection,
    normal,
  };
}

/**
 * Calculate base plane from 4 points
 */
export function calculateBasePlane(points: THREE.Vector3[]): BasePlane {
  if (points.length < 3) {
    throw new Error('Need at least 3 points to calculate plane');
  }

  // Use centroid as plane point
  const point = new THREE.Vector3();
  points.forEach((p) => point.add(p));
  point.divideScalar(points.length);

  // Calculate normal from first 3 points
  const v1 = new THREE.Vector3().subVectors(points[1], points[0]);
  const v2 = new THREE.Vector3().subVectors(points[2], points[0]);
  const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

  // Ensure normal points up
  if (normal.y < 0) {
    normal.negate();
  }

  return { point, normal };
}

/**
 * Calculate height from base plane to a point
 */
export function calculateHeightFromPlane(
  plane: BasePlane,
  point: THREE.Vector3
): number {
  // Height = N · (P - P0) where N is normal, P is point, P0 is plane point
  const relative = new THREE.Vector3().subVectors(point, plane.point);
  const height = Math.abs(relative.dot(plane.normal));
  return height;
}

/**
 * Calculate orthogonality error of the rectangle
 * Returns degrees from 90°
 */
export function calculateOrthogonalityError(points: THREE.Vector3[]): number {
  if (points.length < 4) return 90;

  // Calculate angles at each corner
  const angles: number[] = [];

  for (let i = 0; i < 4; i++) {
    const prev = points[(i + 3) % 4];
    const curr = points[i];
    const next = points[(i + 1) % 4];

    const v1 = new THREE.Vector3().subVectors(prev, curr).normalize();
    const v2 = new THREE.Vector3().subVectors(next, curr).normalize();

    const angle = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2))));
    const angleDeg = angle * (180 / Math.PI);
    angles.push(angleDeg);
  }

  // Calculate average deviation from 90°
  const avgError =
    angles.reduce((sum, a) => sum + Math.abs(90 - a), 0) / angles.length;
  return avgError;
}

/**
 * Get the center of base points
 */
export function getBaseCenter(points: THREE.Vector3[]): THREE.Vector3 {
  const center = new THREE.Vector3();
  points.forEach((p) => center.add(p));
  center.divideScalar(points.length);
  return center;
}

/**
 * Calculate distance between two points
 */
export function distance3D(p1: THREE.Vector3, p2: THREE.Vector3): number {
  return p1.distanceTo(p2);
}

/**
 * Calculate horizontal distance (ignoring Y)
 */
export function horizontalDistance(p1: THREE.Vector3, p2: THREE.Vector3): number {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  return Math.sqrt(dx * dx + dz * dz);
}
