# Phase 1: Orientation Improvements for Depth Box Fitting

**Date:** 2026-02-28
**Scope:** `fitQuantileBox` + `minimumAreaBoundingRect` in `lib/measurement/depth-box-fitting.ts`
**Goal:** Fix yaw drift and box undersizing without changing cloud-building or flood-fill paths.

## Problems

### Orientation drifting
- Yaw is single-source (MABR only) — unstable for near-square footprints and noisy hull points
- Orientation cloud uses fixed 3cm top-band — brittle across object sizes/noisy depth
- Boundary points are computed but not used for yaw/extent

### Box misses object edges
- Extents trimmed by aggressive quantiles (qLo up to 0.10) — intentionally shrinks the box
- No sensor margin to account for depth uncertainty

## Design

### 1. Adaptive Top-Surface Selection

Replace fixed `topY - 0.03m` with percentile-based band:

```
topThreshold = percentile(yVals, 0.80)   // top 20% by height

// Guard: minimum 1.5cm band for noisy/flat data
if (topY - topThreshold < 0.015) {
  topThreshold = topY - 0.015;
}

topPoints = cloud.filter(p => p.y >= topThreshold)

// Fallback chain: top 20% → top 40% → full cloud
if (topPoints.length < 10) {
  topThreshold = percentile(yVals, 0.60);
  topPoints = cloud.filter(p => p.y >= topThreshold);
}
if (topPoints.length < 10) {
  topPoints = localCloud;
}
```

Scales naturally: 2m object → 40cm band, 10cm object → 2cm band.

### 2. PCA Yaw Computation

New function `pcaYawXZ(points)`:

1. Compute centroid of XZ coordinates
2. Build 2x2 covariance matrix (Cxx, Cxz, Czz)
3. Solve eigenvalues via quadratic formula (no library needed)
4. Confidence = anisotropy: `(λ1 - λ2) / (λ1 + λ2 + 1e-9)` — 0=square, 1=elongated
5. Yaw from major eigenvector, normalized to [-π/2, π/2)

Guards: if points < 3 or eigenvalue sum tiny → return `{ yaw: 0, pcaConfidence: 0 }`.

### 3. MABR Confidence via Hull Rectangularity

Extend `minimumAreaBoundingRect` to return rectangularity:

```
rectangularity = clamp(hullArea / (bestRectArea + 1e-9), 0, 1)
```

- `hullArea` via shoelace formula on convex hull
- 1.0 = perfect rectangle, π/4 ≈ 0.785 for circle, lower for irregular
- Guard: hull < 3 points or bestRectArea tiny → confidence 0

### 4. Circular Weighted Blend

Double-angle trick to handle wrap-around at ±π/2:

```
// Map to double-angle vectors (confidence as magnitude)
mabr_x = mabrConf * cos(2 * mabrYaw)
mabr_y = mabrConf * sin(2 * mabrYaw)
pca_x  = pcaConf  * cos(2 * pcaYaw)
pca_y  = pcaConf  * sin(2 * pcaYaw)

// Weighted sum
sx = mabr_x + pca_x
sy = mabr_y + pca_y

// Recover blended yaw
if (sx² + sy² < 1e-10) {
  blendedYaw = mabrConf >= pcaConf ? mabrYaw : pcaYaw   // cancellation fallback
} else {
  blendedYaw = atan2(sy, sx) / 2
}

resultant = sqrt(sx² + sy²) / (mabrConf + pcaConf + 1e-9)
// 1.0 = agreement, 0.0 = full cancellation
```

### 5. Conservative Quantile Extents

Replace aggressive trim with conservative trim + sensor margin:

```
qLo = n < 40 ? 0.05 : n < 120 ? 0.02 : 0.01
qHi = 1 - qLo

SENSOR_MARGIN = 0.02   // 2cm per side for ARCore depth uncertainty
width_m  = clamp((u1 - u0) + 2 * SENSOR_MARGIN, 0.05, 5.0)
depth_m  = clamp((v1 - v0) + 2 * SENSOR_MARGIN, 0.05, 5.0)
```

Center math unaffected (margin expands symmetrically).

## Safety Guardrails

- All candidate yaws normalized to [-π/2, π/2) before blending
- If orientation cloud is too small/degenerate (< 3 points for both PCA and MABR), fall back to old MABR-only path
- Existing size guards (0.03m min, 4.0m max) unchanged

## Files Modified

| File | Change |
|------|--------|
| `lib/measurement/depth-box-fitting.ts` | All changes: new `pcaYawXZ`, modified `minimumAreaBoundingRect`, modified `fitQuantileBox` |

No changes to: `buildCloudFromDepth`, `buildLocalCloud`, `floodFillDepth`, `ARSession.tsx`, state machine.
Both single-frame and multi-frame paths benefit automatically.
