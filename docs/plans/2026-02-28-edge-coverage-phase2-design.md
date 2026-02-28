# Phase 2: Edge Coverage Improvements for Depth Box Fitting

**Date:** 2026-02-28
**Scope:** `buildLocalCloud` annulus params, `maxXZRadius` caps in `fitBoxFromDepth` + `buildCloudFromDepth`
**Goal:** Widen sampling windows so bounding boxes reach object edges, especially at longer range.

## Problems

### Fixed pixel-space annulus
- `rOuterPx = 38` and `rInnerPx = 10` are hardcoded in both call sites
- At close range (0.5m), 38px is generous; at 2m, 38px covers a much smaller angular slice and misses edges

### Hard-capped XZ gating radius
- `fitBoxFromDepth`: `clamp(..., 0.15, 0.35)` — caps at 35cm regardless of object size
- `buildCloudFromDepth`: fixed `0.35` — same cap
- A 60cm-wide object at 1.5m gets its cloud clipped to 35cm from center

## Design

### 1. Depth-Scaled Annulus

Inverse-depth scaling: closer objects occupy more pixels, farther objects fewer. The pixel-space annulus tracks the object's apparent size in the depth buffer.

```
rOuter = clamp(round(60 / centerDepth), 20, 80)
rInner = max(round(rOuter * 0.25), 3)
```

| centerDepth | rOuter | rInner |
|-------------|--------|--------|
| 0.5m        | 80 (capped) | 20 |
| 1.0m        | 60     | 15     |
| 1.5m        | 40     | 10     |
| 2.0m        | 30     | 8      |
| 3.0m        | 20 (capped) | 5 |

Guards:
- Lower cap 20px prevents degenerate clouds at long range
- Upper cap 80px prevents excessive sampling at close range (performance)
- `rInner` always >= 3 so the center-bias gap never disappears

Both `fitBoxFromDepth` and `buildCloudFromDepth` use the same formula.

### 2. Depth-Scaled `maxXZRadius`

Replace hard 0.35m caps with depth-proportional upper bounds.

**`fitBoxFromDepth`** (has flood-fill region diagonal):
```
maxXZRadius = clamp(sqrt(maxDistSq) * 1.10, 0.15, centerDepth * 0.6)
```

**`buildCloudFromDepth`** (no flood-fill, only centerDepth):
```
maxXZRadius = clamp(centerDepth * 0.5, 0.15, 2.0)
```

Multi-frame uses `0.5` vs single-frame `0.6`: tighter XZ gating reduces background accumulation across many viewing angles where there's no flood-fill to constrain the region.

| centerDepth | fitBoxFromDepth upper | buildCloudFromDepth |
|-------------|----------------------|---------------------|
| 0.5m        | 0.30m                | 0.25m               |
| 1.0m        | 0.60m                | 0.50m               |
| 1.5m        | 0.90m                | 0.75m               |
| 2.0m        | 1.20m                | 1.00m               |
| 3.0m        | 1.80m                | 1.50m               |

Guards:
- Lower bound 0.15m at very close range
- `fitBoxFromDepth` upper bound still governed by flood-fill extent, just with higher ceiling
- `buildCloudFromDepth` hard ceiling 2.0m prevents runaway accumulation

### 3. Safety and Logging

**Existing safety nets (unchanged):**
- Floor rejection: `W.y <= floorY + 0.02` in `buildLocalCloud`
- Background wall rejection: view-space Z tolerance in `buildLocalCloud`
- Final size guards: 0.03m min, 4.0m max per dimension
- Flood-fill pixel cap: 20% of buffer

**Logging:**
- `fitBoxFromDepth` diagnostic: add `rOuter`/`rInner` to existing `diag.push`
- `buildCloudFromDepth`: add per-frame log gated by frame sampling (every 30th call) to avoid log spam and AR performance impact

## Files Modified

| File | Change |
|------|--------|
| `lib/measurement/depth-box-fitting.ts` | Compute `rOuter`/`rInner` from `centerDepth` in both `fitBoxFromDepth` and `buildCloudFromDepth`; replace 0.35m hard caps with depth-scaled upper bounds; update diagnostics |

No changes to: `fitQuantileBox`, `floodFillDepth`, `buildLocalCloud` signature, `ARSession.tsx`, state machine.
