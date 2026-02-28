# Phase 2: Edge Coverage Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Widen sampling windows so bounding boxes reach object edges at all distances, by replacing hardcoded annulus radii and XZ caps with depth-scaled values.

**Architecture:** Three changes in `depth-box-fitting.ts`: (1) compute `rOuter`/`rInner` from `centerDepth` before calling `buildLocalCloud`, (2) replace 0.35m hard `maxXZRadius` caps with depth-proportional upper bounds, (3) update diagnostics. No signature changes to `buildLocalCloud`. Both `fitBoxFromDepth` and `buildCloudFromDepth` call sites updated.

**Tech Stack:** TypeScript, Three.js (existing — no new deps)

---

### Task 1: Depth-Scaled Annulus in `fitBoxFromDepth`

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts:190-198`

**Step 1: Compute `rOuter` and `rInner` from `centerDepth`**

Replace the hardcoded `38, 10` arguments at lines 194-195 with computed values. Insert before the `buildLocalCloud` call (after line 189):

```typescript
  // Inverse-depth scaling: closer objects occupy more pixels, farther objects fewer.
  // The pixel-space annulus tracks the object's apparent size in the depth buffer.
  const rOuter = clamp(Math.round(60 / centerDepth), 20, 80);
  const rInner = Math.max(Math.round(rOuter * 0.25), 3);
```

Then update the `buildLocalCloud` call to use these instead of `38, 10`:

```typescript
  const localCloud = buildLocalCloud(
    tapBufX, tapBufY, tapWorld, floorY,
    buffer, width, height, bufToView,
    projMatrixInv, viewMatrixInv, worldToView,
    rOuter,       // was: 38
    rInner,       // was: 10
    1,            // stride: sample every pixel
    maxXZRadius   // adaptive gating radius
  );
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: depth-scaled annulus in fitBoxFromDepth"
```

---

### Task 2: Depth-Scaled Annulus in `buildCloudFromDepth`

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts:260-268`

**Step 1: Compute `rOuter` and `rInner`, same formula as Task 1**

Insert before the `return buildLocalCloud(...)` call (after line 259, before line 261):

```typescript
  // Same inverse-depth annulus as fitBoxFromDepth
  const rOuter = clamp(Math.round(60 / centerDepth), 20, 80);
  const rInner = Math.max(Math.round(rOuter * 0.25), 3);
```

Then update the `buildLocalCloud` call at line 263-268 to use these:

```typescript
  return buildLocalCloud(
    tapBufX, tapBufY, tapWorld, floorY,
    buffer, width, height, bufToView,
    projMatrixInv, viewMatrixInv, worldToView,
    rOuter,       // was: 38
    rInner,       // was: 10
    1, maxXZRadius
  );
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: depth-scaled annulus in buildCloudFromDepth"
```

---

### Task 3: Depth-Scaled `maxXZRadius` in `fitBoxFromDepth`

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts:177`

**Step 1: Replace the 0.35m hard cap**

Change line 177 from:
```typescript
      maxXZRadius = clamp(Math.sqrt(maxDistSq) * 1.10, 0.15, 0.35);
```

To:
```typescript
      maxXZRadius = clamp(Math.sqrt(maxDistSq) * 1.10, 0.15, centerDepth * 0.6);
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: depth-scaled maxXZRadius cap in fitBoxFromDepth"
```

---

### Task 4: Depth-Scaled `maxXZRadius` in `buildCloudFromDepth`

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts:261` (will be at a different line after Task 2 insertions — find `const maxXZRadius = 0.35;`)

**Step 1: Replace the fixed 0.35m radius**

Change:
```typescript
  const maxXZRadius = 0.35;
```

To:
```typescript
  // Tighter than single-frame (0.5 vs 0.6): reduces background accumulation
  // across many viewing angles where there's no flood-fill to constrain the region
  const maxXZRadius = clamp(centerDepth * 0.5, 0.15, 2.0);
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: depth-scaled maxXZRadius in buildCloudFromDepth"
```

---

### Task 5: Update Diagnostics and Logging

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts` — two locations

**Step 1: Add `rOuter`/`rInner` to `fitBoxFromDepth` diagnostics**

Find the diagnostic line (around line 181, will shift after earlier edits):
```typescript
  diag.push(`bnd:${boundary.length} 3D:${worldPoints.length} xzR:${maxXZRadius.toFixed(2)}m`);
```

Replace with:
```typescript
  diag.push(`bnd:${boundary.length} 3D:${worldPoints.length} xzR:${maxXZRadius.toFixed(2)}m rOut:${rOuter}px rIn:${rInner}px`);
```

**Step 2: Add frame-sampled log in `buildCloudFromDepth`**

Add a module-level frame counter near the top of the file (after the imports, before `fitBoxFromDepth`):

```typescript
let _cloudFrameCount = 0;
```

Then in `buildCloudFromDepth`, after the `buildLocalCloud` call, before the return, capture the result and log every 30th frame:

Change:
```typescript
  return buildLocalCloud(
    tapBufX, tapBufY, tapWorld, floorY,
    buffer, width, height, bufToView,
    projMatrixInv, viewMatrixInv, worldToView,
    rOuter, rInner, 1, maxXZRadius
  );
```

To:
```typescript
  const cloud = buildLocalCloud(
    tapBufX, tapBufY, tapWorld, floorY,
    buffer, width, height, bufToView,
    projMatrixInv, viewMatrixInv, worldToView,
    rOuter, rInner, 1, maxXZRadius
  );

  // Log every 30th frame to avoid spam / AR perf impact
  if (++_cloudFrameCount % 30 === 0) {
    console.log(`Cloud frame #${_cloudFrameCount}: depth=${centerDepth.toFixed(2)}m rOuter=${rOuter}px xzR=${maxXZRadius.toFixed(2)}m pts=${cloud.length}`);
  }

  return cloud;
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 4: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: add dynamic annulus/radius values to diagnostics"
```

---

### Task 6: Final Verification

**Step 1: Full build**

Run: `npm run build`
Expected: Clean compilation.

**Step 2: Manual on-device test checklist**

Deploy to device (`npm run dev:https`, open `https://YOUR_IP:3000` from Android Chrome).

1. **Close range (0.5m):** Tap a small object on a desk. Console should show `rOuter=80px`. Box should cover full object width.
2. **Medium range (1.0-1.5m):** Tap a box or bag on the floor. Console should show `rOuter=40-60px`, `xzR` > 0.35m. Box edges should not be clipped short.
3. **Far range (2.0m+):** Tap a large object across the room. Console should show `rOuter=20-30px`, `xzR` > 0.60m.
4. **Multi-frame:** Wait for the 1s accumulation. Cloud frame logs should appear every ~30 frames, showing depth-scaled values.
5. **No regression:** Small objects at close range should still get tight, accurate boxes (not oversized).

**Step 3: Push**

```bash
git push origin walkaround
```
