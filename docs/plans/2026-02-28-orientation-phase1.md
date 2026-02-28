# Phase 1: Orientation Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix yaw drift and box undersizing in `fitQuantileBox` by adding hybrid PCA+MABR yaw blend, adaptive top-surface selection, and conservative quantile extents.

**Architecture:** All changes are in a single file (`lib/measurement/depth-box-fitting.ts`). New helper functions (`pcaYawXZ`, `shoelaceArea`, `normalizeYaw`) are added, `minimumAreaBoundingRect` signature changes to return confidence, and `fitQuantileBox` is refactored to use the hybrid blend. No changes to callers — the API contract (`DepthBoxResult`) is unchanged.

**Tech Stack:** TypeScript, Three.js (Vector3 only), pure math (no new dependencies)

**Verification:** `npm run build` after each task. Final on-device validation with console diagnostics.

---

### Task 1: Add `normalizeYaw` helper

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts` (add after `percentile` function, ~line 283)

**Step 1: Add the function**

Add after the `percentile` function:

```typescript
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
```

**Step 2: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: add normalizeYaw helper for canonical angle range"
```

---

### Task 2: Add `pcaYawXZ` function

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts` (add after `normalizeYaw`)

**Step 1: Add the function**

```typescript
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
```

**Step 2: Build**

Run: `npm run build`
Expected: Clean build. Function is not called yet — no behavior change.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: add PCA yaw computation with anisotropy confidence"
```

---

### Task 3: Add `shoelaceArea` and extend `minimumAreaBoundingRect` to return confidence

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts` (add `shoelaceArea` before `minimumAreaBoundingRect`, then modify `minimumAreaBoundingRect`)

**Step 1: Add `shoelaceArea` function**

Add before `minimumAreaBoundingRect` (~line 491):

```typescript
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
```

**Step 2: Change `minimumAreaBoundingRect` return type and implementation**

Change the function signature from:
```typescript
function minimumAreaBoundingRect(points: { x: number; z: number }[]): number {
```

To:
```typescript
function minimumAreaBoundingRect(points: { x: number; z: number }[]): { yaw: number; mabrConfidence: number } {
```

Change the body:
- Replace `let bestYaw = 0;` with `let bestYaw = 0;` (same)
- After the hull is computed, add: `const hullArea = shoelaceArea(hull);`
- At the early return for `hull.length < 3`: return `{ yaw: 0, mabrConfidence: 0 }`
- At the end, replace `return bestYaw;` with:
```typescript
  const mabrConfidence = clamp(hullArea / (bestArea + 1e-9), 0, 1);
  return { yaw: normalizeYaw(bestYaw), mabrConfidence };
```

Full updated function:

```typescript
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
```

**Step 3: Update the one caller in `fitQuantileBox`**

The old code at line 558:
```typescript
const yaw = xzPoints.length >= 3 ? minimumAreaBoundingRect(xzPoints) : 0;
```

Temporarily update to preserve existing behavior while we integrate:
```typescript
const mabrResult = xzPoints.length >= 3 ? minimumAreaBoundingRect(xzPoints) : { yaw: 0, mabrConfidence: 0 };
const yaw = mabrResult.yaw;
```

**Step 4: Build**

Run: `npm run build`
Expected: Clean build. Behavior unchanged (still MABR-only, just with new return shape).

**Step 5: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: add shoelaceArea, return MABR confidence from minimumAreaBoundingRect"
```

---

### Task 4: Refactor `fitQuantileBox` — adaptive top-surface + hybrid yaw blend

This is the core change. Modifying the yaw computation section of `fitQuantileBox` (currently lines 543-558).

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts` — `fitQuantileBox` function

**Step 1: Replace the yaw computation block**

Replace the current block (lines 551-558):
```typescript
  // --- Yaw from minimum-area bounding rectangle on TOP surface ---
  // Side-face points shift the XZ footprint depending on viewing angle.
  // Top-face points project to the true footprint regardless of camera position.
  const topThreshold = topY - 0.03; // within 3cm of top surface
  const topPoints = localCloud.filter(p => p.y > topThreshold);
  const orientCloud = topPoints.length >= 10 ? topPoints : localCloud;
  const xzPoints = orientCloud.map(p => ({ x: p.x, z: p.z }));
  const mabrResult = xzPoints.length >= 3 ? minimumAreaBoundingRect(xzPoints) : { yaw: 0, mabrConfidence: 0 };
  const yaw = mabrResult.yaw;
```

With:
```typescript
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

  // Safety fallback: if orientation cloud is too small for both methods, use MABR-only
  if (xzPoints.length < 3) {
    yaw = 0;
    yawSource = 'none';
  } else if (mabrResult.mabrConfidence < 0.01 && pcaResult.pcaConfidence < 0.01) {
    // Both degenerate — no reliable orientation
    yaw = 0;
    yawSource = 'none';
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
```

**Step 2: Update `_yawSource` in the return value**

Replace the existing return block's `_yawSource` line:
```typescript
    _yawSource: 'mabr' as 'silhouette' | 'pca' | 'none',
```
With:
```typescript
    _yawSource: yawSource,
```

**Step 3: Update the `console.log` box-fit summary**

Replace:
```typescript
    `rot=${rotation_deg.toFixed(1)}°, topPts=${topPoints.length}/${pixelCount}, ` +
```
With:
```typescript
    `rot=${rotation_deg.toFixed(1)}°(${yawSource}), topPts=${topPoints.length}/${pixelCount}, ` +
```

**Step 4: Build**

Run: `npm run build`
Expected: Clean build. Yaw now uses hybrid blend.

**Step 5: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: hybrid PCA+MABR yaw blend with adaptive top-surface selection"
```

---

### Task 5: Conservative quantile extents with sensor margin

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts` — `fitQuantileBox` function, extent computation block

**Step 1: Replace the quantile extent block**

Replace the current block (lines 575-588):
```typescript
  // Adaptive quantiles: tighten when cloud is small, widen when dense
  const n = localCloud.length;
  const qLo = n < 150 ? 0.10 : (n > 600 ? 0.02 : 0.05);
  const qHi = 1 - qLo;

  const u0 = percentile(uVals, qLo), u1 = percentile(uVals, qHi);
  const v0 = percentile(vVals, qLo), v1 = percentile(vVals, qHi);

  // Center = bounds midpoint (tap-invariant: works even when tap is near edge)
  const uC = (u0 + u1) / 2;
  const vC = (v0 + v1) / 2;

  const width_m = clamp(u1 - u0, 0.05, 5.0);
  const depth_m = clamp(v1 - v0, 0.05, 5.0);
```

With:
```typescript
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
```

**Step 2: Build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: conservative quantile extents with 2cm sensor margin"
```

---

### Task 6: Final build verification and push

**Step 1: Full build**

Run: `npm run build`
Expected: Clean build, no errors or warnings.

**Step 2: Lint**

Run: `npm run lint`
Expected: Clean or pre-existing warnings only.

**Step 3: Push**

```bash
git push
```

---

## On-Device Verification Checklist

After pushing, deploy and test on device:

1. **Console logs:** Look for `Yaw blend:` lines showing both MABR and PCA confidences and the blend result
2. **Near-square objects** (boxes, pillows): yaw should be stable across measurements, PCA confidence should be low (~0.5), MABR confidence varies
3. **Elongated objects** (shoes, keyboards): yaw should align with long axis, both confidences should be high and agree
4. **Small objects** (cups, bottles): adaptive top-band should select fewer points, fallback chain may activate
5. **Box sizing:** boxes should be slightly larger than before (sensor margin), not undersized
6. **Resultant metric:** values near 1.0 = good agreement, values near 0.0 = ambiguous (logged for tuning)
