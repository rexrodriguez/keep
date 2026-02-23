/**
 * Depth-based object boundary detection and bounding box fitting.
 *
 * Given a depth buffer and a tap point, flood-fills to find the object's
 * silhouette, then unprojects boundary points to 3D to fit a
 * gravity-aligned bounding box.
 */

import * as THREE from 'three';
import { DepthData, getDepthAtNormalized, getDepthBuffer } from '@/lib/webxr/depth-sensing';

export interface DepthBoxResult {
  center: THREE.Vector3;
  width_m: number;
  depth_m: number;
  height_m: number;
  rotation_deg: number;
  pixelCount: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  _debug?: string;
}

export function fitBoxFromDepth(
  depthData: DepthData,
  tapNormX: number,
  tapNormY: number,
  viewerPose: XRViewerPose,
  floorY: number
): DepthBoxResult | null {
  const { width, height } = depthData;

  // 1. Read center depth
  const centerDepth = getDepthAtNormalized(depthData, tapNormX, tapNormY);
  if (centerDepth <= 0 || centerDepth > 10) {
    console.warn('No valid depth at tap point:', centerDepth);
    return null;
  }

  // 2. Get full depth buffer for flood-fill
  const buffer = getDepthBuffer(depthData);
  if (!buffer) {
    console.warn('Failed to read depth buffer');
    return null;
  }

  // === Coordinate transform: view ↔ buffer ===
  // The depth buffer may be rotated/flipped relative to the viewport.
  // normDepthBufferFromNormView maps normalized view coords → normalized buffer coords.
  const depthInfo = depthData.depthInfo;
  const xform = depthInfo.normDepthBufferFromNormView;
  const { viewToBuf, bufToView } = getCoordTransforms(xform);

  // Convert tap from view-space to buffer-space
  const tapBuf = viewToBuf(tapNormX, tapNormY);
  const tapBufX = Math.round(tapBuf.x * (width - 1));
  const tapBufY = Math.round(tapBuf.y * (height - 1));

  // === DEPTH DIAGNOSTIC ===
  const diag: string[] = [];
  const tapIdx = tapBufY * width + tapBufX;
  const bufferAtTap = (tapIdx >= 0 && tapIdx < buffer.length) ? buffer[tapIdx] : 0;
  diag.push(`buf:${width}x${height} r2m:${depthInfo.rawValueToMeters}`);
  diag.push(`tap: API=${centerDepth.toFixed(3)}m buf=${bufferAtTap.toFixed(3)}m diff=${Math.abs(centerDepth - bufferAtTap).toFixed(3)}m`);
  if (xform?.matrix) {
    const m = xform.matrix;
    diag.push(`xform:[${m[0].toFixed(2)},${m[4].toFixed(2)},${m[12].toFixed(2)}]/[${m[1].toFixed(2)},${m[5].toFixed(2)},${m[13].toFixed(2)}]`);
  }
  diag.push(`tapBuf:(${tapBufX},${tapBufY})`);

  // 3. Flood-fill from tap point
  // Depth tolerance: how far a pixel's depth can differ from the tap depth
  const depthTolerance = Math.max(centerDepth * 0.05, 0.03);
  // Gradient threshold: max depth jump between adjacent pixels (edge detection)
  const gradientThreshold = Math.max(centerDepth * 0.01, 0.01);
  // Spatial radius: max pixel distance from tap point
  const maxPixelRadius = Math.round(Math.max(width, height) * 0.15);

  const region = floodFillDepth(
    buffer, width, height,
    tapBufX, tapBufY,
    centerDepth, depthTolerance,
    gradientThreshold, maxPixelRadius
  );

  if (region.count < 4) {
    console.warn('Too few depth pixels in object region:', region.count);
    return null;
  }

  diag.push(`fill:${region.count}px [${region.minX},${region.minY}]-[${region.maxX},${region.maxY}]`);

  // 4. Unproject boundary points to 3D world space
  const view = viewerPose.views[0];
  const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
  const projMatrixInv = projMatrix.clone().invert();
  const viewMatrixInv = new THREE.Matrix4().fromArray(view.transform.matrix);

  const worldPoints: THREE.Vector3[] = [];
  const stepX = Math.max(1, Math.floor((region.maxX - region.minX) / 20));
  const stepY = Math.max(1, Math.floor((region.maxY - region.minY) / 20));

  for (let by = region.minY; by <= region.maxY; by += stepY) {
    for (let bx = region.minX; bx <= region.maxX; bx += stepX) {
      const idx = by * width + bx;
      if (!region.mask[idx]) continue;

      const d = buffer[idx];
      if (d <= 0) continue;

      // Convert buffer pixel coords → view-normalized coords for unprojection
      const bufNormX = (bx + 0.5) / width;
      const bufNormY = (by + 0.5) / height;
      const viewCoord = bufToView(bufNormX, bufNormY);

      const worldPt = unprojectDepthToWorld(viewCoord.x, viewCoord.y, d, projMatrixInv, viewMatrixInv);
      if (worldPt) {
        worldPoints.push(worldPt);
      }
    }
  }

  if (worldPoints.length < 3) {
    console.warn('Too few 3D points after unprojection:', worldPoints.length);
    return null;
  }

  diag.push(`3D pts:${worldPoints.length}`);

  // 5. Fit gravity-aligned bounding box
  const result = fitGravityAlignedBox(worldPoints, floorY);

  diag.push(`box: ${(result.width_m*39.37).toFixed(0)}"x${(result.depth_m*39.37).toFixed(0)}"x${(result.height_m*39.37).toFixed(0)}"`);
  result._debug = diag.join('\n');

  // 6. Size guards
  if (result.width_m < 0.03 || result.depth_m < 0.03 || result.height_m < 0.03) {
    console.warn('Object too small, likely noise');
    return null;
  }
  if (result.width_m > 4.0 || result.depth_m > 4.0 || result.height_m > 4.0) {
    console.warn('Object too large, likely background');
    return null;
  }

  return result;
}

function floodFillDepth(
  buffer: Float32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  centerDepth: number,
  tolerance: number,
  gradientThreshold: number,
  maxRadius: number
): { mask: Uint8Array; count: number; minX: number; maxX: number; minY: number; maxY: number } {
  const mask = new Uint8Array(width * height);
  let count = 0;
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  // Cap at 10% of buffer — a single object shouldn't fill more
  const MAX_FILL_PIXELS = Math.floor(width * height * 0.10);

  const queue: [number, number][] = [[startX, startY]];
  const startIdx = startY * width + startX;
  if (buffer[startIdx] <= 0) {
    return { mask, count: 0, minX, maxX, minY, maxY };
  }
  mask[startIdx] = 1;

  const radiusSq = maxRadius * maxRadius;

  let queueHead = 0;
  while (queueHead < queue.length) {
    if (count >= MAX_FILL_PIXELS) {
      console.warn('Flood-fill hit max pixel limit');
      break;
    }
    const [x, y] = queue[queueHead++];
    count++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    const currentDepth = buffer[y * width + x];

    const neighbors: [number, number][] = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (mask[nIdx]) continue;

      // Spatial radius check — don't spread too far from tap point
      const dx = nx - startX;
      const dy = ny - startY;
      if (dx * dx + dy * dy > radiusSq) continue;

      const d = buffer[nIdx];
      if (d <= 0) continue;

      // Absolute tolerance: depth must be close to the original tap depth
      if (Math.abs(d - centerDepth) > tolerance) continue;

      // Gradient check: reject sharp depth jumps between neighbors (object edges)
      if (Math.abs(d - currentDepth) > gradientThreshold) continue;

      mask[nIdx] = 1;
      queue.push([nx, ny]);
    }
  }

  return { mask, count, minX, maxX, minY, maxY };
}

function unprojectDepthToWorld(
  normX: number,
  normY: number,
  depthMeters: number,
  projMatrixInv: THREE.Matrix4,
  viewMatrixInv: THREE.Matrix4
): THREE.Vector3 | null {
  const ndcX = normX * 2 - 1;
  const ndcY = 1 - normY * 2;

  const nearPoint = new THREE.Vector4(ndcX, ndcY, -1, 1);
  nearPoint.applyMatrix4(projMatrixInv);
  nearPoint.divideScalar(nearPoint.w);

  const rayDir = new THREE.Vector3(nearPoint.x, nearPoint.y, nearPoint.z).normalize();

  if (Math.abs(rayDir.z) < 1e-6) return null;
  const t = depthMeters / Math.abs(rayDir.z);
  const pointCam = rayDir.multiplyScalar(t);

  const pointWorld = new THREE.Vector4(pointCam.x, pointCam.y, pointCam.z, 1);
  pointWorld.applyMatrix4(viewMatrixInv);

  return new THREE.Vector3(pointWorld.x, pointWorld.y, pointWorld.z);
}

function fitGravityAlignedBox(
  points: THREE.Vector3[],
  floorY: number
): DepthBoxResult {
  // Separate points into "above floor" (object surface) and "near floor" (floor contamination).
  // Only use above-floor points for XZ extents to avoid floor pixels inflating width/depth.
  const FLOOR_MARGIN = 0.03; // 3cm above floor = "on the object"

  const aboveFloor: THREE.Vector3[] = [];
  let maxY = -Infinity;

  for (const p of points) {
    if (p.y > maxY) maxY = p.y;
    if (p.y > floorY + FLOOR_MARGIN) {
      aboveFloor.push(p);
    }
  }

  // Use above-floor points for XZ extents if we have enough, otherwise fall back to all points
  const xzPoints = aboveFloor.length >= 3 ? aboveFloor : points;

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of xzPoints) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  const bottomY = floorY;
  const topY = maxY;

  const width_m = Math.max(0.05, Math.min(maxX - minX, 5.0));
  const depth_m = Math.max(0.05, Math.min(maxZ - minZ, 5.0));
  const height_m = Math.max(0.05, Math.min(topY - bottomY, 5.0));

  const center = new THREE.Vector3(
    (minX + maxX) / 2,
    bottomY + height_m / 2,
    (minZ + maxZ) / 2
  );

  // Axis-aligned: single-viewpoint depth can't reliably determine object orientation.
  // User can manually rotate with handles after placement.
  const rotation_deg = 0;

  const pixelCount = points.length;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (pixelCount > 50 && width_m > 0.05 && depth_m > 0.05 && height_m > 0.05) {
    confidence = 'HIGH';
  } else if (pixelCount > 20) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  console.log(
    `Box fit: ${width_m.toFixed(3)} x ${depth_m.toFixed(3)} x ${height_m.toFixed(3)} m, ` +
    `rot=${rotation_deg.toFixed(1)}°, ` +
    `center=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}), ` +
    `${pixelCount} total pts, ${aboveFloor.length} above floor, confidence=${confidence}`
  );

  return { center, width_m, depth_m, height_m, rotation_deg, pixelCount, confidence };
}

/**
 * Extract view↔buffer coordinate transforms from normDepthBufferFromNormView.
 * The depth buffer may be rotated/flipped relative to the viewport (common on Android).
 * Returns identity transforms if the matrix is not available.
 */
function getCoordTransforms(xform: { matrix: Float32Array } | null | undefined) {
  type CoordFn = (x: number, y: number) => { x: number; y: number };

  if (!xform?.matrix) {
    // No transform available — assume identity
    const identity: CoordFn = (x, y) => ({ x, y });
    return { viewToBuf: identity, bufToView: identity };
  }

  const m = xform.matrix;
  // Extract 2D affine: bufX = a*vx + c*vy + tx, bufY = b*vx + d*vy + ty
  const a = m[0], c = m[4], tx = m[12];
  const b = m[1], d = m[5], ty = m[13];

  const viewToBuf: CoordFn = (vx, vy) => ({
    x: a * vx + c * vy + tx,
    y: b * vx + d * vy + ty,
  });

  // Compute 2D affine inverse
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) {
    // Degenerate transform — fall back to identity
    const identity: CoordFn = (x, y) => ({ x, y });
    return { viewToBuf: identity, bufToView: identity };
  }

  const ia = d / det, ic = -c / det, itx = (c * ty - d * tx) / det;
  const ib = -b / det, id = a / det, ity = (b * tx - a * ty) / det;

  const bufToView: CoordFn = (bx, by) => ({
    x: ia * bx + ic * by + itx,
    y: ib * bx + id * by + ity,
  });

  return { viewToBuf, bufToView };
}
