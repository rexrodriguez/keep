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
  _pcaRatio?: number;
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

  // Estimate world yaw from 2D silhouette (more stable than 3D PCA)
  const silhouetteYaw = estimateYawFromSilhouette(
    boundary, buffer, width, height, bufToView, projMatrixInv, viewMatrixInv
  );

  diag.push(`bnd:${boundary.length} 3D:${worldPoints.length}`);

  // 5. Fit gravity-aligned bounding box
  const result = fitGravityAlignedBox(worldPoints, floorY, tapWorld, silhouetteYaw);

  diag.push(`box: ${(result.width_m*39.37).toFixed(0)}"x${(result.depth_m*39.37).toFixed(0)}"x${(result.height_m*39.37).toFixed(0)}" rot:${result.rotation_deg.toFixed(0)}° sil:${result._pcaRatio?.toFixed(1) ?? '?'}`);
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

function fitGravityAlignedBox(
  points: THREE.Vector3[],
  floorY: number,
  tapWorld: THREE.Vector3 | null,
  silhouetteYaw: { yaw: number; ratio: number } | null
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
  let xzPoints = aboveFloor.length >= 3 ? aboveFloor : points;

  // XZ proximity filter: reject points far from the tap point in XZ plane.
  // Floor leakage spreads out in XZ while the object stays compact.
  if (tapWorld && xzPoints.length > 3) {
    const MAX_XZ_RADIUS = 0.50; // 50cm — most household objects fit within this
    const filtered = xzPoints.filter(p => {
      const dx = p.x - tapWorld.x;
      const dz = p.z - tapWorld.z;
      return dx * dx + dz * dz <= MAX_XZ_RADIUS * MAX_XZ_RADIUS;
    });
    if (filtered.length >= 3) {
      xzPoints = filtered;
    }
  }

  // Use silhouette-derived world yaw for rotation (more stable than 3D PCA).
  // The 2D silhouette captures the object's visual orientation reliably,
  // then we lift it to world space by unprojecting two axis points.
  const angle = (silhouetteYaw && silhouetteYaw.ratio >= 1.5) ? silhouetteYaw.yaw : 0;
  const silRatio = silhouetteYaw?.ratio ?? 1;

  // Compute XZ centroid for rotation frame
  let meanX = 0, meanZ = 0;
  for (const p of xzPoints) { meanX += p.x; meanZ += p.z; }
  meanX /= xzPoints.length;
  meanZ /= xzPoints.length;

  // Compute bounding box in the (possibly rotated) frame
  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);

  let minU = Infinity, maxU = -Infinity;
  let minV = Infinity, maxV = -Infinity;

  for (const p of xzPoints) {
    const dx = p.x - meanX;
    const dz = p.z - meanZ;
    const u = dx * cosA - dz * sinA;
    const v = dx * sinA + dz * cosA;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const bottomY = floorY;
  const topY = maxY;

  const width_m = Math.max(0.05, Math.min(maxU - minU, 5.0));
  const depth_m = Math.max(0.05, Math.min(maxV - minV, 5.0));
  const height_m = Math.max(0.05, Math.min(topY - bottomY, 5.0));

  // Rotate center back to world space
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  const cosAInv = Math.cos(angle);
  const sinAInv = Math.sin(angle);

  const center = new THREE.Vector3(
    meanX + centerU * cosAInv - centerV * sinAInv,
    bottomY + height_m / 2,
    meanZ + centerU * sinAInv + centerV * cosAInv
  );

  const rotation_deg = (angle * 180) / Math.PI;

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

  return { center, width_m, depth_m, height_m, rotation_deg, pixelCount, confidence, _pcaRatio: silRatio };
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

/**
 * PCA on 2D boundary pixels in buffer space.
 * More stable than 3D PCA because buffer pixels are clean and dense,
 * while 3D points have depth noise and view-dependent coverage.
 */
function pca2D(boundary: [number, number][]) {
  let mx = 0, my = 0;
  for (const [x, y] of boundary) { mx += x; my += y; }
  const n = boundary.length;
  mx /= n; my /= n;

  let cxx = 0, cxy = 0, cyy = 0;
  for (const [x, y] of boundary) {
    const dx = x - mx, dy = y - my;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  }
  cxx /= n; cxy /= n; cyy /= n;

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = trace / 2 - disc;
  const ratio = lambda2 > 1e-10 ? lambda1 / lambda2 : 1;

  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  return { angle, mx, my, ratio };
}

/**
 * Estimate world-space yaw from the 2D silhouette's principal axis.
 * Picks two points along the 2D major axis, unprojects them to 3D,
 * and computes the XZ direction vector → yaw angle.
 */
function estimateYawFromSilhouette(
  boundary: [number, number][],
  depthBuf: Float32Array,
  width: number,
  height: number,
  bufToView: (x: number, y: number) => { x: number; y: number },
  projInv: THREE.Matrix4,
  viewInv: THREE.Matrix4
): { yaw: number; ratio: number } | null {
  if (boundary.length < 20) return null;

  const { angle, mx, my, ratio } = pca2D(boundary);

  // Only compute yaw if silhouette is clearly elongated
  if (ratio < 1.5) return { yaw: 0, ratio };

  // Pick two sample pixels along the major axis, offset from centroid
  const L = Math.min(12, Math.floor(Math.sqrt(boundary.length) / 2));
  const ax = Math.cos(angle), ay = Math.sin(angle);
  const bx0 = Math.round(mx - ax * L), by0 = Math.round(my - ay * L);
  const bx1 = Math.round(mx + ax * L), by1 = Math.round(my + ay * L);

  // Clamp to buffer bounds
  if (bx0 < 0 || bx0 >= width || by0 < 0 || by0 >= height) return { yaw: 0, ratio };
  if (bx1 < 0 || bx1 >= width || by1 < 0 || by1 >= height) return { yaw: 0, ratio };

  const d0 = depthBuf[by0 * width + bx0];
  const d1 = depthBuf[by1 * width + bx1];
  if (!(d0 > 0 && d1 > 0)) return { yaw: 0, ratio };

  const v0 = bufToView((bx0 + 0.5) / width, (by0 + 0.5) / height);
  const v1 = bufToView((bx1 + 0.5) / width, (by1 + 0.5) / height);

  const w0 = unprojectDepthToWorld(v0.x, v0.y, d0, projInv, viewInv);
  const w1 = unprojectDepthToWorld(v1.x, v1.y, d1, projInv, viewInv);
  if (!w0 || !w1) return { yaw: 0, ratio };

  // Direction in world XZ plane
  const dir = w1.clone().sub(w0);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) return { yaw: 0, ratio };
  dir.normalize();

  const yaw = Math.atan2(dir.x, dir.z);
  return { yaw, ratio };
}
