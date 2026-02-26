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
  _yawSource?: 'silhouette' | 'pca' | 'none';
  _xzRadius?: number;
  _marchExtents?: string;
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

  // Estimate world yaw from 2D silhouette (more stable than 3D PCA)
  const silhouetteYaw = estimateYawFromSilhouette(
    boundary, buffer, width, height, bufToView, projMatrixInv, viewMatrixInv
  );

  diag.push(`bnd:${boundary.length} 3D:${worldPoints.length} xzR:${maxXZRadius.toFixed(2)}m`);
  diag.push(`yaw:${silhouetteYaw ? (silhouetteYaw.yaw * 180 / Math.PI).toFixed(0) + '°' : 'n/a'} q:${silhouetteYaw?.quality.toFixed(2) ?? '0'}`);

  // 5. Fit gravity-aligned bounding box via ray-march
  const worldToView = viewMatrixInv.clone().invert();
  const marchOpts: RayMarchOpts = {
    depthBuf: buffer, bufW: width, bufH: height,
    viewToBuf, bufToView, worldToView,
    proj: projMatrix, projInv: projMatrixInv, viewInv: viewMatrixInv
  };

  const result = fitGravityAlignedBox(
    worldPoints, floorY, tapWorld, maxXZRadius,
    silhouetteYaw?.yaw ?? null, silhouetteYaw?.quality ?? 0,
    marchOpts
  );

  diag.push(`box: ${(result.width_m*39.37).toFixed(0)}"x${(result.depth_m*39.37).toFixed(0)}"x${(result.height_m*39.37).toFixed(0)}" rot:${result.rotation_deg.toFixed(0)}° src:${result._yawSource ?? '?'} march:${result._marchExtents ?? '?'}`);
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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
 * Project a world point to view-normalized coords [0,1].
 * Accounts for: world → view → clip → NDC → normalized.
 */
function worldToViewNorm(
  pWorld: THREE.Vector3,
  worldToView: THREE.Matrix4,
  proj: THREE.Matrix4
): { x: number; y: number } | null {
  const v = new THREE.Vector4(pWorld.x, pWorld.y, pWorld.z, 1);
  v.applyMatrix4(worldToView);
  v.applyMatrix4(proj);
  if (Math.abs(v.w) < 1e-8) return null;
  const ndcX = v.x / v.w;
  const ndcY = v.y / v.w;
  const x = ndcX * 0.5 + 0.5;
  const y = 1 - (ndcY * 0.5 + 0.5);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * March outward from center along dirXZ in world space, sampling the depth
 * buffer at each step to find where the object surface ends.
 * Returns the distance (meters) of the last "on-object" sample.
 */
function marchExtentXZ(
  center: THREE.Vector3,
  dirXZ: THREE.Vector3,
  floorY: number,
  upOffsetM: number,
  stepM: number,
  maxDistM: number,
  xzEpsM: number,
  depthBuf: Float32Array,
  bufW: number, bufH: number,
  viewToBuf: (x: number, y: number) => { x: number; y: number },
  bufToView: (x: number, y: number) => { x: number; y: number },
  worldToView: THREE.Matrix4,
  proj: THREE.Matrix4,
  projInv: THREE.Matrix4,
  viewInv: THREE.Matrix4
): number {
  // Neighborhood search: find the depth sample whose unprojected world point
  // best matches the marched target P in XZ (and is above floor).
  function bestMatchNear(target: THREE.Vector3, bx: number, by: number, radius: number) {
    let bestW: THREE.Vector3 | null = null;
    let bestDist = Infinity;
    for (let oy = -radius; oy <= radius; oy++) {
      const yy = by + oy;
      if (yy < 0 || yy >= bufH) continue;
      for (let ox = -radius; ox <= radius; ox++) {
        const xx = bx + ox;
        if (xx < 0 || xx >= bufW) continue;
        const d = depthBuf[yy * bufW + xx];
        if (!(d > 0)) continue;
        const v = bufToView((xx + 0.5) / bufW, (yy + 0.5) / bufH);
        const W = unprojectDepthToWorld(v.x, v.y, d, projInv, viewInv);
        if (!W) continue;
        if (W.y <= floorY + 0.02) continue; // reject floor
        const dx = W.x - target.x;
        const dz = W.z - target.z;
        const xzDist = Math.sqrt(dx * dx + dz * dz);
        if (xzDist < bestDist) {
          bestDist = xzDist;
          bestW = W;
        }
      }
    }
    return { bestW, bestDist };
  }

  const P = new THREE.Vector3();
  let lastGood = 0;
  let missStreak = 0;

  const perpEps = 0.06;   // perpendicular tolerance (m)
  const alongEps = 0.08;  // along-axis tolerance (m)

  for (let t = 0; t <= maxDistM; t += stepM) {
    P.copy(center).addScaledVector(dirXZ, t);
    P.y = floorY + upOffsetM; // march on a consistent slice above the floor

    // Project candidate world point to view-normalized coords
    const vNorm = worldToViewNorm(P, worldToView, proj);
    if (!vNorm || vNorm.x < 0 || vNorm.x > 1 || vNorm.y < 0 || vNorm.y > 1) break;

    // View-normalized → buffer pixel (handles Android 90° rotation)
    const b = viewToBuf(vNorm.x, vNorm.y);
    const bx = Math.floor(b.x * (bufW - 1));
    const by = Math.floor(b.y * (bufH - 1));
    if (bx < 0 || by < 0 || bx >= bufW || by >= bufH) break;

    // Search a 5×5 neighborhood for the best XZ match above floor
    const { bestW, bestDist } = bestMatchNear(P, bx, by, 2);

    if (bestW && bestDist <= xzEpsM) {
      // Directional consistency: matched point must lie at the correct
      // distance along the march direction, not just be "close in XZ"
      const vx = bestW.x - center.x;
      const vz = bestW.z - center.z;
      const along = vx * dirXZ.x + vz * dirXZ.z;
      const px = vx - along * dirXZ.x;
      const pz = vz - along * dirXZ.z;
      const perp = Math.sqrt(px * px + pz * pz);

      if (Math.abs(along - t) <= alongEps && perp <= perpEps) {
        lastGood = t;
        missStreak = 0;
      } else {
        missStreak++;
        if (missStreak >= 2) break;
      }
    } else {
      missStreak++;
      if (missStreak >= 2) break;
    }
  }

  return lastGood;
}

interface RayMarchOpts {
  depthBuf: Float32Array;
  bufW: number;
  bufH: number;
  viewToBuf: (x: number, y: number) => { x: number; y: number };
  bufToView: (x: number, y: number) => { x: number; y: number };
  worldToView: THREE.Matrix4;
  proj: THREE.Matrix4;
  projInv: THREE.Matrix4;
  viewInv: THREE.Matrix4;
}

function fitGravityAlignedBox(
  points: THREE.Vector3[],
  floorY: number,
  tapWorld: THREE.Vector3 | null,
  maxSearchDist: number,
  overrideYawRad: number | null,
  overrideYawQuality: number,
  marchOpts: RayMarchOpts
): DepthBoxResult {
  // --- Height from point cloud (maxY - floorY) ---
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y > maxY) maxY = p.y;
  }
  const bottomY = floorY;
  const topY = Number.isFinite(maxY) ? maxY : floorY + 0.05;
  const height_m = clamp(topY - bottomY, 0.05, 5.0);

  // --- Yaw selection (unchanged: silhouette > PCA > 0°) ---
  const pca = computePCA_XZ(points);
  const usePcaRotation = pca.ratio > 4.0 && points.length >= 20;
  const useSilhouette = overrideYawRad !== null && overrideYawQuality >= 0.3;
  const yaw =
    useSilhouette ? overrideYawRad! :
    (usePcaRotation ? pca.angle : 0);
  const yawSource: 'silhouette' | 'pca' | 'none' =
    useSilhouette ? 'silhouette' : (usePcaRotation ? 'pca' : 'none');

  // --- Center: use tapWorld if available, else point cloud centroid ---
  let cx: number, cz: number;
  if (tapWorld) {
    cx = tapWorld.x;
    cz = tapWorld.z;
  } else {
    cx = 0; cz = 0;
    for (const p of points) { cx += p.x; cz += p.z; }
    cx /= points.length;
    cz /= points.length;
  }
  const marchCenter = new THREE.Vector3(cx, floorY, cz);

  // --- Ray-march width/depth along rotated axes ---
  const U = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
  const V = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();

  const stepM = 0.01;     // 1cm steps
  const upOffsetM = 0.08; // sample 8cm above floor
  const xzEpsM = 0.06;    // 6cm proximity tolerance

  const { depthBuf, bufW, bufH, viewToBuf, bufToView, worldToView, proj, projInv, viewInv } = marchOpts;

  const posU = marchExtentXZ(marchCenter, U, floorY, upOffsetM, stepM, maxSearchDist, xzEpsM, depthBuf, bufW, bufH, viewToBuf, bufToView, worldToView, proj, projInv, viewInv);
  const negU = marchExtentXZ(marchCenter, U.clone().negate(), floorY, upOffsetM, stepM, maxSearchDist, xzEpsM, depthBuf, bufW, bufH, viewToBuf, bufToView, worldToView, proj, projInv, viewInv);
  const posV = marchExtentXZ(marchCenter, V, floorY, upOffsetM, stepM, maxSearchDist, xzEpsM, depthBuf, bufW, bufH, viewToBuf, bufToView, worldToView, proj, projInv, viewInv);
  const negV = marchExtentXZ(marchCenter, V.clone().negate(), floorY, upOffsetM, stepM, maxSearchDist, xzEpsM, depthBuf, bufW, bufH, viewToBuf, bufToView, worldToView, proj, projInv, viewInv);

  const width_m = clamp(posU + negU, 0.05, 5.0);
  const depth_m = clamp(posV + negV, 0.05, 5.0);

  // Recenter box based on march extents (shift from tap toward measured center)
  const halfShiftU = (posU - negU) / 2;
  const halfShiftV = (posV - negV) / 2;
  const center = new THREE.Vector3(
    cx + U.x * halfShiftU + V.x * halfShiftV,
    bottomY + height_m / 2,
    cz + U.z * halfShiftU + V.z * halfShiftV
  );

  const rotation_deg = (yaw * 180) / Math.PI;
  const pixelCount = points.length;

  // Confidence based on march coverage + point count
  const marchTotal = posU + negU + posV + negV;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (pixelCount > 50 && marchTotal > 0.15) {
    confidence = 'HIGH';
  } else if (pixelCount > 20 || marchTotal > 0.08) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  console.log(
    `Box fit (ray-march): ${width_m.toFixed(3)} x ${depth_m.toFixed(3)} x ${height_m.toFixed(3)} m, ` +
    `rot=${rotation_deg.toFixed(1)}°, yaw=${yawSource}, ` +
    `march: +U=${posU.toFixed(2)} -U=${negU.toFixed(2)} +V=${posV.toFixed(2)} -V=${negV.toFixed(2)}, ` +
    `${pixelCount} pts, confidence=${confidence}`
  );

  return {
    center, width_m, depth_m, height_m, rotation_deg, pixelCount, confidence,
    _pcaRatio: pca.ratio, _yawSource: yawSource, _xzRadius: maxSearchDist,
    _marchExtents: `U+${posU.toFixed(2)}-${negU.toFixed(2)} V+${posV.toFixed(2)}-${negV.toFixed(2)}`
  };
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

/**
 * Estimate world-space yaw from the 2D silhouette's principal axis.
 * Always attempts to compute yaw (no ratio gate) — even slightly
 * non-symmetric silhouettes from perspective provide useful signal.
 * Returns null only if boundary is too small or depth sampling fails.
 */
function estimateYawFromSilhouette(
  boundary: [number, number][],
  depthBuf: Float32Array,
  width: number,
  height: number,
  bufToView: (x: number, y: number) => { x: number; y: number },
  projInv: THREE.Matrix4,
  viewInv: THREE.Matrix4
): { yaw: number; quality: number } | null {
  if (boundary.length < 20) return null;

  const pca = pca2D(boundary);

  const ax = Math.cos(pca.angle), ay = Math.sin(pca.angle);
  const L = Math.max(8, Math.min(24, Math.round(Math.sqrt(boundary.length) / 2)));

  const x0 = Math.round(pca.mx - ax * L), y0 = Math.round(pca.my - ay * L);
  const x1 = Math.round(pca.mx + ax * L), y1 = Math.round(pca.my + ay * L);

  const d0 = sampleDepthNearest(depthBuf, width, height, x0, y0, 2);
  const d1 = sampleDepthNearest(depthBuf, width, height, x1, y1, 2);
  if (!(d0 > 0 && d1 > 0)) return null;

  const v0 = bufToView((x0 + 0.5) / width, (y0 + 0.5) / height);
  const v1 = bufToView((x1 + 0.5) / width, (y1 + 0.5) / height);

  const w0 = unprojectDepthToWorld(v0.x, v0.y, d0, projInv, viewInv);
  const w1 = unprojectDepthToWorld(v1.x, v1.y, d1, projInv, viewInv);
  if (!w0 || !w1) return null;

  const dir = w1.clone().sub(w0);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) return null;
  dir.normalize();

  const yaw = Math.atan2(dir.x, dir.z);
  const quality = Math.min(1, boundary.length / 400);
  return { yaw, quality };
}

/**
 * PCA on XZ-projected 3D points. Used as fallback when silhouette yaw is unavailable.
 */
function computePCA_XZ(points: THREE.Vector3[]) {
  let sumX = 0, sumZ = 0;
  for (const p of points) { sumX += p.x; sumZ += p.z; }
  const n = points.length;
  const meanX = sumX / n, meanZ = sumZ / n;

  let cxx = 0, cxz = 0, czz = 0;
  for (const p of points) {
    const dx = p.x - meanX, dz = p.z - meanZ;
    cxx += dx * dx; cxz += dx * dz; czz += dz * dz;
  }
  cxx /= n; cxz /= n; czz /= n;

  const trace = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + disc;
  const lambda2 = trace / 2 - disc;
  const ratio = lambda2 > 1e-10 ? lambda1 / lambda2 : 999;
  const angle = 0.5 * Math.atan2(2 * cxz, cxx - czz);

  return { angle, meanX, meanZ, ratio };
}
