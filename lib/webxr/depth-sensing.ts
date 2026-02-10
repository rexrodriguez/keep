import * as THREE from 'three';
import { XRCPUDepthInformation } from '@/lib/types';

export interface DepthBoxResult {
  success: boolean;
  width_m: number;
  depth_m: number;
  height_m: number;
  center: THREE.Vector3;
  pointCount: number;
}

const MIN_DIMENSION_M = 0.05;
const MAX_DIMENSION_M = 5.0;
const MIN_VALID_DEPTH_M = 0.1;
const MAX_VALID_DEPTH_M = 10.0;
const MIN_POINT_COUNT = 10;
const FLOOR_TOLERANCE_M = 0.03;
const SAMPLE_RADIUS_PX = 60;
const SAMPLE_STEP_PX = 3;

/**
 * Compute a bounding box from depth data around a tap point.
 *
 * Projects the tap position into the depth buffer, samples a neighborhood
 * of pixels, unprojects them to 3D in local-floor space, filters out floor
 * points, and returns the AABB of the remaining above-floor points.
 */
export function computeDepthBoundingBox(
  depthInfo: XRCPUDepthInformation,
  view: XRView,
  viewerPose: XRViewerPose,
  tapFloorPosition: THREE.Vector3,
  floorY: number,
): DepthBoxResult {
  const fail: DepthBoxResult = {
    success: false,
    width_m: 0,
    depth_m: 0,
    height_m: 0,
    center: tapFloorPosition.clone(),
    pointCount: 0,
  };

  // Build matrices for coordinate transforms
  const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
  const invProjMatrix = projMatrix.clone().invert();
  const viewMatrix = new THREE.Matrix4().fromArray(view.transform.matrix);

  // Project tap position (world space) into normalized view coordinates
  const invViewMatrix = viewMatrix.clone().invert();
  const tapViewSpace = tapFloorPosition.clone().applyMatrix4(invViewMatrix);
  const tapClip = tapViewSpace.clone().applyMatrix4(projMatrix);
  // Clip to normalized view: x = (clipX + 1) / 2, y = (1 - clipY) / 2
  const tapNormViewX = (tapClip.x + 1) / 2;
  const tapNormViewY = (1 - tapClip.y) / 2;

  // Convert to depth buffer pixel coordinates
  const tapPixelX = Math.round(tapNormViewX * depthInfo.width);
  const tapPixelY = Math.round(tapNormViewY * depthInfo.height);

  // Sample grid of depth values around the tap point
  const worldPoints: THREE.Vector3[] = [];

  for (let dy = -SAMPLE_RADIUS_PX; dy <= SAMPLE_RADIUS_PX; dy += SAMPLE_STEP_PX) {
    for (let dx = -SAMPLE_RADIUS_PX; dx <= SAMPLE_RADIUS_PX; dx += SAMPLE_STEP_PX) {
      const px = tapPixelX + dx;
      const py = tapPixelY + dy;

      // Skip out-of-bounds pixels
      if (px < 0 || px >= depthInfo.width || py < 0 || py >= depthInfo.height) {
        continue;
      }

      // getDepthInMeters takes normalized depth buffer coordinates (0-1)
      const normDbX = px / depthInfo.width;
      const normDbY = py / depthInfo.height;

      let depthM: number;
      try {
        depthM = depthInfo.getDepthInMeters(normDbX, normDbY);
      } catch {
        continue;
      }

      // Filter invalid depth values
      if (depthM <= MIN_VALID_DEPTH_M || depthM >= MAX_VALID_DEPTH_M || !isFinite(depthM)) {
        continue;
      }

      // Unproject: pixel → normalized view → clip → view space → world space
      const normViewX = px / depthInfo.width;
      const normViewY = py / depthInfo.height;
      const clipX = normViewX * 2 - 1;
      const clipY = 1 - normViewY * 2;

      // Unproject clip coords to view-space ray direction
      const ndcPoint = new THREE.Vector4(clipX, clipY, -1, 1);
      ndcPoint.applyMatrix4(invProjMatrix);
      const rayDir = new THREE.Vector3(
        ndcPoint.x / ndcPoint.w,
        ndcPoint.y / ndcPoint.w,
        ndcPoint.z / ndcPoint.w,
      ).normalize();

      // Scale ray by depth to get view-space point
      const viewSpacePoint = rayDir.multiplyScalar(depthM);

      // Transform to local-floor (world) space
      const worldPoint = viewSpacePoint.applyMatrix4(viewMatrix);

      worldPoints.push(worldPoint);
    }
  }

  // Separate above-floor points from floor points
  const aboveFloorPoints = worldPoints.filter(
    p => p.y > floorY + FLOOR_TOLERANCE_M
  );

  if (aboveFloorPoints.length < MIN_POINT_COUNT) {
    return fail;
  }

  // IQR-based outlier rejection on each axis
  const filtered = rejectOutliers(aboveFloorPoints);

  if (filtered.length < MIN_POINT_COUNT) {
    return fail;
  }

  // Compute AABB from filtered above-floor points
  let minX = Infinity, maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of filtered) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  let width = maxX - minX;
  let depth = maxZ - minZ;
  let height = maxY - floorY;

  // Clamp to sane ranges
  width = clamp(width, MIN_DIMENSION_M, MAX_DIMENSION_M);
  depth = clamp(depth, MIN_DIMENSION_M, MAX_DIMENSION_M);
  height = clamp(height, MIN_DIMENSION_M, MAX_DIMENSION_M);

  const center = new THREE.Vector3(
    (minX + maxX) / 2,
    floorY,
    (minZ + maxZ) / 2,
  );

  return {
    success: true,
    width_m: width,
    depth_m: depth,
    height_m: height,
    center,
    pointCount: filtered.length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * IQR-based outlier rejection: for each axis, discard points beyond
 * 1.5 * IQR from Q1/Q3. Returns the intersection of inliers across all axes.
 */
function rejectOutliers(points: THREE.Vector3[]): THREE.Vector3[] {
  const xs = points.map(p => p.x).sort((a, b) => a - b);
  const ys = points.map(p => p.y).sort((a, b) => a - b);
  const zs = points.map(p => p.z).sort((a, b) => a - b);

  const xRange = iqrRange(xs);
  const yRange = iqrRange(ys);
  const zRange = iqrRange(zs);

  return points.filter(p =>
    p.x >= xRange[0] && p.x <= xRange[1] &&
    p.y >= yRange[0] && p.y <= yRange[1] &&
    p.z >= zRange[0] && p.z <= zRange[1]
  );
}

function iqrRange(sorted: number[]): [number, number] {
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  return [q1 - 1.5 * iqr, q3 + 1.5 * iqr];
}
