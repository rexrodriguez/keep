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
  _yawSource?: string;
  _quantileExtents?: string;
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
  // Sanity check: log how corners map through viewToBuf
  const t0 = viewToBuf(0, 0), t1 = viewToBuf(1, 0), t2 = viewToBuf(0, 1);
  diag.push(`v2b: (0,0)->(${t0.x.toFixed(2)},${t0.y.toFixed(2)}) (1,0)->(${t1.x.toFixed(2)},${t1.y.toFixed(2)}) (0,1)->(${t2.x.toFixed(2)},${t2.y.toFixed(2)})`);

  // 3. Flood-fill from tap point
  // Depth tolerance: how far a pixel's depth can differ from the tap depth
  // Cap at 12cm — safe to be generous since XZ proximity filter catches floor leaking in 3D
  const depthTolerance = Math.min(Math.max(centerDepth * 0.06, 0.03), 0.12);
  // Gradient threshold: max depth jump between adjacent pixels (edge detection)
  // Must be loose enough to tolerate sensor noise (~5-10mm) but catch real edges (~10cm+)
  const gradientThreshold = Math.max(centerDepth * 0.02, 0.015);
  // Spatial radius: max pixel distance from tap point
  const maxPixelRadius = Math.round(Math.max(width, height) * 0.30);

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

  diag.push(`fill:${region.count}px${region.hitCap ? ' CAP!' : ''} [${region.minX},${region.minY}]-[${region.maxX},${region.maxY}]`);

  // 4. Extract boundary pixels from flood-fill region
  // Boundary pixels define the true silhouette extents — interior grid sampling
  // misses outermost pixels and systematically undersizes the bounding box.
  const boundary: [number, number][] = [];
  for (let by = region.minY; by <= region.maxY; by++) {
    for (let bx = region.minX; bx <= region.maxX; bx++) {
      const idx = by * width + bx;
      if (!region.mask[idx]) continue;

      // Pixel is on the boundary if any 4-neighbor is outside the mask
      const left  = bx > 0          ? region.mask[idx - 1] : 0;
      const right = bx < width - 1  ? region.mask[idx + 1] : 0;
      const up    = by > 0          ? region.mask[idx - width] : 0;
      const down  = by < height - 1 ? region.mask[idx + width] : 0;

      if (!(left && right && up && down)) {
        boundary.push([bx, by]);
      }
    }
  }

  // Unproject boundary points to 3D world space
  const view = viewerPose.views[0];
  const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
  const projMatrixInv = projMatrix.clone().invert();
  const viewMatrixInv = new THREE.Matrix4().fromArray(view.transform.matrix);

  const worldPoints: THREE.Vector3[] = [];

  // Subsample boundary if very large (cap at ~400 points for performance)
  const everyNth = boundary.length > 400 ? Math.ceil(boundary.length / 400) : 1;

  for (let i = 0; i < boundary.length; i += everyNth) {
    const [bx, by] = boundary[i];
    const d = buffer[by * width + bx];
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

  if (worldPoints.length < 3) {
    console.warn('Too few 3D points after unprojection:', worldPoints.length);
    return null;
  }

  // Unproject tap point to 3D for XZ proximity filtering
  const tapWorld = unprojectDepthToWorld(tapNormX, tapNormY, centerDepth, projMatrixInv, viewMatrixInv);

  // Adaptive XZ gating radius: project flood-fill region corners to world space
  // at the tap depth, then use max XZ distance from tap as the radius.
  // This scales the filter with the apparent object size instead of using a fixed 50cm.
  let maxXZRadius = 0.50; // fallback
  if (tapWorld) {
    const corners: [number, number][] = [
      [region.minX, region.minY], [region.maxX, region.minY],
      [region.minX, region.maxY], [region.maxX, region.maxY],
    ];
    let maxDistSq = 0;
    for (const [cx, cy] of corners) {
      const bNx = (cx + 0.5) / width;
      const bNy = (cy + 0.5) / height;
      const vCoord = bufToView(bNx, bNy);
      const cDepth = sampleDepthNearest(buffer, width, height, cx, cy, 3);
      const wp = unprojectDepthToWorld(vCoord.x, vCoord.y, cDepth > 0 ? cDepth : centerDepth, projMatrixInv, viewMatrixInv);
      if (wp) {
        const dx = wp.x - tapWorld.x, dz = wp.z - tapWorld.z;
        maxDistSq = Math.max(maxDistSq, dx * dx + dz * dz);
      }
    }
    if (maxDistSq > 0) {
      maxXZRadius = clamp(Math.sqrt(maxDistSq) * 1.10, 0.15, 0.35);
    }
  }

  diag.push(`bnd:${boundary.length} 3D:${worldPoints.length} xzR:${maxXZRadius.toFixed(2)}m`);

  // 5. Build dense local cloud and fit quantile box
  if (!tapWorld) {
    console.warn('No tap world point for local cloud');
    return null;
  }

  const worldToView = viewMatrixInv.clone().invert();
  const localCloud = buildLocalCloud(
    tapBufX, tapBufY, tapWorld, floorY,
    buffer, width, height, bufToView,
    projMatrixInv, viewMatrixInv, worldToView,
    38,           // rOuterPx: outer annulus radius in buffer pixels
    10,           // rInnerPx: inner annulus radius (skip tap-center bias)
    1,            // stride: sample every pixel
    maxXZRadius   // maxXZ: adaptive gating radius
  );

  diag.push(`cloud:${localCloud.length}pts`);

  if (localCloud.length < 10) {
    console.warn('Too few points in local cloud:', localCloud.length);
    return null;
  }

  const result = fitQuantileBox(localCloud, floorY, tapWorld);

  diag.push(`box: ${(result.width_m*39.37).toFixed(0)}"x${(result.depth_m*39.37).toFixed(0)}"x${(result.height_m*39.37).toFixed(0)}" rot:${result.rotation_deg.toFixed(0)}° src:${result._yawSource ?? '?'} ext:${result._quantileExtents ?? '?'}`);
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

/**
 * Build a point cloud from a single depth frame for multi-frame accumulation.
 * Returns world-space points, or null if depth data is invalid.
 */
export function buildCloudFromDepth(
  depthData: DepthData,
  tapNormX: number,
  tapNormY: number,
  viewerPose: XRViewerPose,
  floorY: number
): THREE.Vector3[] | null {
  const { width, height } = depthData;

  const centerDepth = getDepthAtNormalized(depthData, tapNormX, tapNormY);
  if (centerDepth <= 0 || centerDepth > 10) return null;

  const buffer = getDepthBuffer(depthData);
  if (!buffer) return null;

  const depthInfo = depthData.depthInfo;
  const xform = depthInfo.normDepthBufferFromNormView;
  const { viewToBuf, bufToView } = getCoordTransforms(xform);

  const tapBuf = viewToBuf(tapNormX, tapNormY);
  const tapBufX = Math.round(tapBuf.x * (width - 1));
  const tapBufY = Math.round(tapBuf.y * (height - 1));

  const view = viewerPose.views[0];
  const projMatrixInv = new THREE.Matrix4().fromArray(view.projectionMatrix).invert();
  const viewMatrixInv = new THREE.Matrix4().fromArray(view.transform.matrix);
  const worldToView = viewMatrixInv.clone().invert();

  const tapWorld = unprojectDepthToWorld(tapNormX, tapNormY, centerDepth, projMatrixInv, viewMatrixInv);
  if (!tapWorld) return null;

  // Use a fixed generous XZ radius for accumulation (individual frame clouds get merged)
  const maxXZRadius = 0.35;

  return buildLocalCloud(
    tapBufX, tapBufY, tapWorld, floorY,
    buffer, width, height, bufToView,
    projMatrixInv, viewMatrixInv, worldToView,
    38, 10, 1, maxXZRadius
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

/**
 * Normalize a yaw angle to the canonical range [-π/2, π/2).
 * Box orientations are symmetric: θ and θ+π are the same box.
 */
function normalizeYaw(yaw: number): number {
  let y = yaw;
  while (y >= Math.PI / 2) y -= Math.PI;
  while (y < -Math.PI / 2) y += Math.PI;
  return y;
}

/**
 * Compute principal axis orientation of XZ footprint via PCA.
 * Returns yaw angle and anisotropy confidence (0 = isotropic, 1 = elongated).
 */
function pcaYawXZ(points: { x: number; z: number }[]): { yaw: number; pcaConfidence: number } {
  if (points.length < 3) {
    return { yaw: 0, pcaConfidence: 0 };
  }

  // Centroid
  let cx = 0, cz = 0;
  for (const p of points) { cx += p.x; cz += p.z; }
  cx /= points.length;
  cz /= points.length;

  // 2x2 covariance matrix
  let Cxx = 0, Cxz = 0, Czz = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dz = p.z - cz;
    Cxx += dx * dx;
    Cxz += dx * dz;
    Czz += dz * dz;
  }
  Cxx /= points.length;
  Cxz /= points.length;
  Czz /= points.length;

  // Eigenvalues via quadratic formula
  const trace = Cxx + Czz;
  const det = Cxx * Czz - Cxz * Cxz;
  const disc = Math.sqrt(Math.max(trace * trace / 4 - det, 0));
  const lambda1 = trace / 2 + disc; // major
  const lambda2 = trace / 2 - disc; // minor

  const eigSum = lambda1 + lambda2;
  if (eigSum < 1e-8) {
    return { yaw: 0, pcaConfidence: 0 };
  }

  // Anisotropy: 0 = isotropic/square, 1 = strongly elongated
  const anisotropy = (lambda1 - lambda2) / (eigSum + 1e-9);

  // Major eigenvector for λ1: (Cxx - λ2, Cxz) or (Cxz, Czz - λ2)
  let evX = Cxz;
  let evZ = lambda1 - Cxx;
  const evLen = Math.sqrt(evX * evX + evZ * evZ);
  if (evLen < 1e-10) {
    // Fallback: try other form
    evX = lambda1 - Czz;
    evZ = Cxz;
  }

  const yaw = normalizeYaw(Math.atan2(evX, evZ));
  return { yaw, pcaConfidence: anisotropy };
}

/**
 * Build a local point cloud by sampling an annulus of pixels around the
 * tap point in buffer space. The annulus (ring) skips interior pixels near
 * the tap center, reducing bias toward the tap point and emphasizing
 * edge-relevant samples for better extent estimation.
 */
function buildLocalCloud(
  tapBufX: number,
  tapBufY: number,
  tapWorld: THREE.Vector3,
  floorY: number,
  depthBuf: Float32Array,
  bufW: number,
  bufH: number,
  bufToView: (x: number, y: number) => { x: number; y: number },
  projInv: THREE.Matrix4,
  viewInv: THREE.Matrix4,
  worldToView: THREE.Matrix4,
  rOuterPx: number,
  rInnerPx: number,
  stride: number,
  maxXZ: number
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const rOuter2 = rOuterPx * rOuterPx;
  const rInner2 = rInnerPx * rInnerPx;

  const x0 = Math.max(0, Math.floor(tapBufX - rOuterPx));
  const x1 = Math.min(bufW - 1, Math.ceil(tapBufX + rOuterPx));
  const y0 = Math.max(0, Math.floor(tapBufY - rOuterPx));
  const y1 = Math.min(bufH - 1, Math.ceil(tapBufY + rOuterPx));

  // View-space Z of tap point for depth consistency
  const tv = new THREE.Vector4(tapWorld.x, tapWorld.y, tapWorld.z, 1).applyMatrix4(worldToView);
  const tapViewZ = Math.abs(tv.z);
  // Allow surfaces up to 5cm + 4% behind the tap depth (reject background walls)
  const zTol = 0.05 + 0.04 * tapViewZ;

  for (let y = y0; y <= y1; y += stride) {
    const dy = y - tapBufY;
    for (let x = x0; x <= x1; x += stride) {
      const dx = x - tapBufX;
      const d2 = dx * dx + dy * dy;
      if (d2 > rOuter2) continue;
      if (d2 < rInner2) continue; // annulus: skip interior

      const d = depthBuf[y * bufW + x];
      if (!(d > 0)) continue;

      const v = bufToView((x + 0.5) / bufW, (y + 0.5) / bufH);
      const W = unprojectDepthToWorld(v.x, v.y, d, projInv, viewInv);
      if (!W) continue;

      // Reject floor
      if (W.y <= floorY + 0.02) continue;

      // Reject points too far in XZ from tap
      const ddx = W.x - tapWorld.x;
      const ddz = W.z - tapWorld.z;
      if (Math.sqrt(ddx * ddx + ddz * ddz) > maxXZ) continue;

      // Reject background surfaces (view-space Z consistency)
      const wv = new THREE.Vector4(W.x, W.y, W.z, 1).applyMatrix4(worldToView);
      if (Math.abs(wv.z) > tapViewZ + zTol) continue;

      pts.push(W);
    }
  }
  return pts;
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
): { mask: Uint8Array; count: number; minX: number; maxX: number; minY: number; maxY: number; hitCap: boolean } {
  const mask = new Uint8Array(width * height);
  let count = 0;
  let hitCap = false;
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  // Cap at 20% of buffer — safe to be generous since XZ proximity filter catches floor leaking in 3D
  const MAX_FILL_PIXELS = Math.floor(width * height * 0.20);

  const queue: [number, number][] = [[startX, startY]];
  const startIdx = startY * width + startX;
  if (buffer[startIdx] <= 0) {
    return { mask, count: 0, minX, maxX, minY, maxY, hitCap: false };
  }
  mask[startIdx] = 1;

  const radiusSq = maxRadius * maxRadius;

  let queueHead = 0;
  while (queueHead < queue.length) {
    if (count >= MAX_FILL_PIXELS) {
      console.warn('Flood-fill hit max pixel limit');
      hitCap = true;
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

  return { mask, count, minX, maxX, minY, maxY, hitCap };
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

/**
 * 2D convex hull via Andrew's monotone chain algorithm.
 * Input: XZ-projected points. Output: hull in counter-clockwise order.
 */
function convexHullXZ(points: { x: number; z: number }[]): { x: number; z: number }[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const n = pts.length;
  if (n <= 2) return pts;

  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const hull: { x: number; z: number }[] = [];

  // Lower hull
  for (const p of pts) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }

  // Upper hull
  const lower = hull.length + 1;
  for (let i = n - 2; i >= 0; i--) {
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], pts[i]) <= 0) hull.pop();
    hull.push(pts[i]);
  }

  hull.pop(); // last point duplicates first
  return hull;
}

/**
 * Area of a polygon via the shoelace formula.
 */
function shoelaceArea(hull: { x: number; z: number }[]): number {
  let area = 0;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += hull[i].x * hull[j].z;
    area -= hull[j].x * hull[i].z;
  }
  return Math.abs(area) / 2;
}

/**
 * Minimum-area bounding rectangle via rotating calipers on the convex hull.
 * Returns the yaw angle that produces the tightest-fitting oriented rectangle.
 * This is view-invariant — depends only on the XZ footprint geometry.
 */
function minimumAreaBoundingRect(points: { x: number; z: number }[]): { yaw: number; mabrConfidence: number } {
  const hull = convexHullXZ(points);
  if (hull.length < 3) return { yaw: 0, mabrConfidence: 0 };

  const hullArea = shoelaceArea(hull);
  let bestArea = Infinity;
  let bestYaw = 0;

  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = hull[j].x - hull[i].x;
    const ez = hull[j].z - hull[i].z;
    const len = Math.sqrt(ex * ex + ez * ez);
    if (len < 1e-10) continue;

    const ux = ex / len, uz = ez / len;
    const vx = -uz, vz = ux;

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.z * uz;
      const v = p.x * vx + p.z * vz;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }

    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      bestYaw = Math.atan2(ux, uz);
    }
  }

  const mabrConfidence = clamp(hullArea / (bestArea + 1e-9), 0, 1);
  return { yaw: normalizeYaw(bestYaw), mabrConfidence };
}

/**
 * Fit a gravity-aligned bounding box using a local point cloud.
 * Orientation comes from minimum-area bounding rectangle on the XZ
 * convex hull (view-invariant). Sizing uses quantile extents (outlier-robust).
 */
export function fitQuantileBox(
  localCloud: THREE.Vector3[],
  floorY: number,
  tapWorld: THREE.Vector3,
): DepthBoxResult {
  // --- Height from local cloud (95th percentile Y - floorY) ---
  const yVals = localCloud.map(p => p.y).sort((a, b) => a - b);
  const topY = percentile(yVals, 0.95);
  const height_m = clamp(
    Number.isFinite(topY) ? topY - floorY : 0.05,
    0.05, 5.0
  );

  // --- Adaptive top-surface selection ---
  // Use top 20% of points by Y. Scales with object height (not fixed metric).
  let topThreshold = percentile(yVals, 0.80);
  // Guard: minimum 1.5cm band for noisy/flat data
  if (topY - topThreshold < 0.015) {
    topThreshold = topY - 0.015;
  }
  let topPoints = localCloud.filter(p => p.y >= topThreshold);
  // Fallback chain: top 20% → top 40% → full cloud
  if (topPoints.length < 10) {
    topThreshold = percentile(yVals, 0.60);
    topPoints = localCloud.filter(p => p.y >= topThreshold);
  }
  const orientCloud = topPoints.length < 10 ? localCloud : topPoints;

  // --- Hybrid yaw: MABR + PCA with confidence-weighted circular blend ---
  const xzPoints = orientCloud.map(p => ({ x: p.x, z: p.z }));
  const mabrResult = xzPoints.length >= 3
    ? minimumAreaBoundingRect(xzPoints)
    : { yaw: 0, mabrConfidence: 0 };
  const pcaResult = pcaYawXZ(xzPoints);

  let yaw: number;
  let yawSource: string;

  // Safety fallback: if orientation cloud is too small, no orientation possible
  if (xzPoints.length < 3) {
    yaw = 0;
    yawSource = 'too-few';
  } else if (mabrResult.mabrConfidence < 0.01 && pcaResult.pcaConfidence < 0.01) {
    // Both very low confidence — use stronger source rather than forcing axis-aligned
    yaw = mabrResult.mabrConfidence >= pcaResult.pcaConfidence ? mabrResult.yaw : pcaResult.yaw;
    yawSource = mabrResult.mabrConfidence >= pcaResult.pcaConfidence ? 'mabr-weak' : 'pca-weak';
  } else {
    // Double-angle circular blend
    const mabrX = mabrResult.mabrConfidence * Math.cos(2 * mabrResult.yaw);
    const mabrY = mabrResult.mabrConfidence * Math.sin(2 * mabrResult.yaw);
    const pcaX = pcaResult.pcaConfidence * Math.cos(2 * pcaResult.yaw);
    const pcaY = pcaResult.pcaConfidence * Math.sin(2 * pcaResult.yaw);

    const sx = mabrX + pcaX;
    const sy = mabrY + pcaY;
    const resultant = Math.sqrt(sx * sx + sy * sy) / (mabrResult.mabrConfidence + pcaResult.pcaConfidence + 1e-9);

    if (sx * sx + sy * sy < 1e-10) {
      // Cancellation — pick higher-confidence source
      yaw = mabrResult.mabrConfidence >= pcaResult.pcaConfidence ? mabrResult.yaw : pcaResult.yaw;
      yawSource = mabrResult.mabrConfidence >= pcaResult.pcaConfidence ? 'mabr-cancel' : 'pca-cancel';
    } else {
      yaw = normalizeYaw(Math.atan2(sy, sx) / 2);
      yawSource = `blend(r=${resultant.toFixed(2)})`;
    }

    console.log(
      `Yaw blend: mabr=${(mabrResult.yaw * 180 / Math.PI).toFixed(1)}°(conf=${mabrResult.mabrConfidence.toFixed(2)}) ` +
      `pca=${(pcaResult.yaw * 180 / Math.PI).toFixed(1)}°(conf=${pcaResult.pcaConfidence.toFixed(2)}) ` +
      `→ ${(yaw * 180 / Math.PI).toFixed(1)}° src=${yawSource} topPts=${topPoints.length}`
    );
  }

  // --- Rotate into yaw-aligned frame and compute quantile extents ---
  const U = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const V = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const uVals: number[] = [];
  const vVals: number[] = [];
  for (const p of localCloud) {
    const dx = p.x - tapWorld.x;
    const dz = p.z - tapWorld.z;
    uVals.push(dx * U.x + dz * U.z);
    vVals.push(dx * V.x + dz * V.z);
  }
  uVals.sort((a, b) => a - b);
  vVals.sort((a, b) => a - b);

  // Conservative quantile trim: reject only extreme outliers, not edges
  const n = localCloud.length;
  const qLo = n < 40 ? 0.05 : n < 120 ? 0.02 : 0.01;
  const qHi = 1 - qLo;

  const u0 = percentile(uVals, qLo), u1 = percentile(uVals, qHi);
  const v0 = percentile(vVals, qLo), v1 = percentile(vVals, qHi);

  // Center = bounds midpoint (tap-invariant: works even when tap is near edge)
  const uC = (u0 + u1) / 2;
  const vC = (v0 + v1) / 2;

  // Sensor margin: depth noise means true edges are slightly beyond measured points
  // 2cm per side accounts for typical ARCore depth uncertainty at 1-2m range
  const SENSOR_MARGIN = 0.02;
  const width_m = clamp((u1 - u0) + 2 * SENSOR_MARGIN, 0.05, 5.0);
  const depth_m = clamp((v1 - v0) + 2 * SENSOR_MARGIN, 0.05, 5.0);

  const center = tapWorld.clone()
    .addScaledVector(U, uC)
    .addScaledVector(V, vC);
  center.y = floorY + height_m / 2;

  const rotation_deg = (yaw * 180) / Math.PI;
  const pixelCount = localCloud.length;

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (pixelCount > 100 && width_m > 0.08 && depth_m > 0.08) {
    confidence = 'HIGH';
  } else if (pixelCount > 30) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  console.log(
    `Box fit: ${width_m.toFixed(3)} x ${depth_m.toFixed(3)} x ${height_m.toFixed(3)} m, ` +
    `rot=${rotation_deg.toFixed(1)}°(${yawSource}), topPts=${topPoints.length}/${pixelCount}, ` +
    `cloud=${pixelCount} pts, U=[${u0.toFixed(2)},${u1.toFixed(2)}] V=[${v0.toFixed(2)},${v1.toFixed(2)}], ` +
    `ctr_offset=(${uC.toFixed(3)},${vC.toFixed(3)}), confidence=${confidence}`
  );

  return {
    center, width_m, depth_m, height_m, rotation_deg, pixelCount, confidence,
    _yawSource: yawSource,
    _quantileExtents: `q=${qLo.toFixed(2)}..${qHi.toFixed(2)} U[${u0.toFixed(2)},${u1.toFixed(2)}] V[${v0.toFixed(2)},${v1.toFixed(2)}]`
  };
}

/**
 * Extract view↔buffer coordinate transforms from normDepthBufferFromNormView.
 * The depth buffer may be rotated/flipped relative to the viewport (common on Android).
 * Uses full Matrix4 multiply to avoid row/column-major index ambiguity.
 * Returns identity transforms if the matrix is not available.
 */
function getCoordTransforms(xform: { matrix: Float32Array } | null | undefined) {
  type CoordFn = (x: number, y: number) => { x: number; y: number };

  if (!xform?.matrix) {
    const identity: CoordFn = (x, y) => ({ x, y });
    return { viewToBuf: identity, bufToView: identity };
  }

  // Use the 4x4 matrix directly — avoids all layout/index assumptions.
  const M = new THREE.Matrix4().fromArray(xform.matrix);
  const Minv = M.clone().invert();

  const viewToBuf: CoordFn = (vx, vy) => {
    const v = new THREE.Vector4(vx, vy, 0, 1).applyMatrix4(M);
    const iw = Math.abs(v.w) > 1e-8 ? 1 / v.w : 1;
    return { x: v.x * iw, y: v.y * iw };
  };

  const bufToView: CoordFn = (bx, by) => {
    const v = new THREE.Vector4(bx, by, 0, 1).applyMatrix4(Minv);
    const iw = Math.abs(v.w) > 1e-8 ? 1 / v.w : 1;
    return { x: v.x * iw, y: v.y * iw };
  };

  return { viewToBuf, bufToView };
}

/**
 * Sample depth at (x,y), falling back to a small neighborhood search
 * if the exact pixel has no valid depth (common at silhouette edges).
 */
function sampleDepthNearest(
  buffer: Float32Array, width: number, height: number,
  x: number, y: number, r: number
): number {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const d0 = buffer[cy * width + cx];
  if (d0 > 0) return d0;

  for (let rr = 1; rr <= r; rr++) {
    for (let oy = -rr; oy <= rr; oy++) {
      for (let ox = -rr; ox <= rr; ox++) {
        const xx = cx + ox, yy = cy + oy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const d = buffer[yy * width + xx];
        if (d > 0) return d;
      }
    }
  }
  return 0;
}

