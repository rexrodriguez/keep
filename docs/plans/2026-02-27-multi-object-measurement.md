# Multi-Object Measurement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to measure multiple objects, curate a list with thumbnails, and search for storage that fits everything.

**Architecture:** Items list lives in `page.tsx` state. AR session sends items up via callbacks. New `ItemListView` component sits between AR and radius select. Storage search sums volumes across all items.

**Tech Stack:** Next.js 14, React, Three.js, WebXR, Tailwind CSS

---

### Task 1: Add MeasuredItem type and volume helper

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/measurement/calculations.ts`

**Step 1: Add MeasuredItem interface to types.ts**

Add after the `MeasurementData` interface (line ~60):

```typescript
export interface MeasuredItem {
  id: string;
  width_m: number;
  depth_m: number;
  height_m: number;
  confidence: ConfidenceLevel;
  thumbnail: string;
  addedAt: number;
}
```

**Step 2: Add volume helper to calculations.ts**

Add at end of file:

```typescript
/**
 * Compute total volume of multiple measured items.
 */
export function totalVolume(items: MeasuredItem[]): number {
  return items.reduce((sum, item) => sum + item.width_m * item.depth_m * item.height_m, 0);
}
```

Add `MeasuredItem` to the import from `@/lib/types`.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add lib/types.ts lib/measurement/calculations.ts
git commit -m "feat: add MeasuredItem type and totalVolume helper"
```

---

### Task 2: Update page.tsx for multi-item flow

**Files:**
- Modify: `app/page.tsx`

**Step 1: Add ITEM_LIST to AppState and replace measurementData with items array**

In `app/page.tsx`:

1. Add `'ITEM_LIST'` to the `AppState` union type (line 22-30).

2. Replace state:
   ```typescript
   // Remove:
   const [measurementData, setMeasurementData] = useState<MeasurementData | null>(null);
   // Add:
   const [measuredItems, setMeasuredItems] = useState<MeasuredItem[]>([]);
   ```

3. Add import for `MeasuredItem` from `@/lib/types`.

**Step 2: Replace handleFindStorage with handleAddItem and handleDone**

Remove `handleFindStorage`. Add:

```typescript
const handleAddItem = useCallback((item: MeasuredItem) => {
  setMeasuredItems(prev => [...prev, item]);
}, []);

const handleDone = useCallback(() => {
  setAppState('ITEM_LIST');
}, []);
```

**Step 3: Add handleDeleteItem and handleAddMore**

```typescript
const handleDeleteItem = useCallback((id: string) => {
  setMeasuredItems(prev => prev.filter(item => item.id !== id));
}, []);

const handleAddMore = useCallback(() => {
  setAppState('AR_ACTIVE');
}, []);
```

**Step 4: Update handleSearch to use measuredItems**

Replace the `measurementData` usage in `handleSearch`:
- Guard: `if (measuredItems.length === 0) return;`
- Compute total volume: `const totalVol = totalVolume(measuredItems);`
- For the API request dimensions, use the largest item:
  ```typescript
  const largest = measuredItems.reduce((a, b) =>
    a.width_m * a.depth_m * a.height_m > b.width_m * b.depth_m * b.height_m ? a : b
  );
  const request: StorageSearchRequest = {
    width_cm: largest.width_m * 100,
    depth_cm: largest.depth_m * 100,
    height_cm: largest.height_m * 100,
    volume_m3: totalVol,
    radius_km: radiusMiles * 1.60934,
    user_location: userLocation,
    timestamp: new Date().toISOString(),
  };
  ```

Import `totalVolume` from `@/lib/measurement/calculations`.

**Step 5: Update handleNewMeasurement**

```typescript
const handleNewMeasurement = useCallback(() => {
  setAppState('ITEM_LIST');
}, []);
```

**Step 6: Update AR_ACTIVE render block**

Pass new props to ARSession (line ~263):
```tsx
<ARSession
  overlayRef={overlayRef}
  onExit={handleExitAR}
  onAddItem={handleAddItem}
  onDone={handleDone}
  itemCount={measuredItems.length}
  tutorialEnabled={tutorialEnabled}
/>
```

**Step 7: Add ITEM_LIST render block**

Add before the `RADIUS_SELECT` block:
```tsx
if (appState === 'ITEM_LIST') {
  return (
    <ItemListView
      items={measuredItems}
      onDelete={handleDeleteItem}
      onAddMore={handleAddMore}
      onFindStorage={() => setAppState('RADIUS_SELECT')}
    />
  );
}
```

Import `ItemListView` (will create in Task 5). For now, create a placeholder:
```tsx
// Temporary — will be replaced in Task 5
const ItemListView = ({ onAddMore }: { items: MeasuredItem[]; onDelete: (id: string) => void; onAddMore: () => void; onFindStorage: () => void }) => (
  <div className="flex items-center justify-center min-h-screen bg-gray-900">
    <button onClick={onAddMore} className="text-white">Placeholder - Add More</button>
  </div>
);
```

**Step 8: Update RadiusSlider render block**

Pass items to RadiusSlider (will update component in Task 6):
```tsx
<RadiusSlider
  value={radiusMiles}
  onChange={setRadiusMiles}
  onSearch={handleSearch}
  onBack={() => setAppState('ITEM_LIST')}
  isSearching={appState === 'SEARCHING'}
/>
```

Note: `onBack` now goes to `ITEM_LIST` instead of `AR_ACTIVE`.

**Step 9: Verify build**

Run: `npm run build`
Expected: Build succeeds (ItemListView is a local placeholder).

**Step 10: Commit**

```bash
git add app/page.tsx
git commit -m "feat: update page.tsx for multi-item flow with ITEM_LIST state"
```

---

### Task 3: Update ARSession callbacks and add thumbnail capture

**Files:**
- Modify: `lib/three/scene-setup.ts` (line 25-29)
- Modify: `components/ARSession.tsx`

**Step 1: Enable preserveDrawingBuffer on renderer**

In `lib/three/scene-setup.ts` line 25-29, add `preserveDrawingBuffer: true`:

```typescript
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
```

**Step 2: Update ARSessionProps interface**

In `components/ARSession.tsx` lines 47-52, replace:

```typescript
interface ARSessionProps {
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onExit: () => void;
  onAddItem: (item: MeasuredItem) => void;
  onDone: () => void;
  itemCount: number;
  tutorialEnabled?: boolean;
}
```

Update the destructuring on line 54:
```typescript
export default function ARSession({ overlayRef, onExit, onAddItem, onDone, itemCount, tutorialEnabled = false }: ARSessionProps) {
```

Add `MeasuredItem` to imports from `@/lib/types`.

**Step 3: Replace handleFindStorage with handleAddItem**

Replace the `handleFindStorage` callback (lines 908-921):

```typescript
const handleAddItem = useCallback(() => {
  if (context.dragStart && context.dragEnd) {
    // Capture thumbnail from canvas
    let thumbnail = '';
    if (sceneContextRef.current?.renderer) {
      try {
        thumbnail = sceneContextRef.current.renderer.domElement.toDataURL('image/jpeg', 0.5);
      } catch (e) {
        console.warn('Failed to capture thumbnail:', e);
      }
    }

    const item: MeasuredItem = {
      id: crypto.randomUUID(),
      width_m: context.width_m,
      depth_m: context.depth_m,
      height_m: context.height_m,
      confidence: context.llmEstimate?.confidence || 'MEDIUM',
      thumbnail,
      addedAt: Date.now(),
    };

    onAddItem(item);
    // Reset to measure another object (re-lock floor for different elevations)
    dispatch({ type: 'RESET' });
  }
}, [context.dragStart, context.dragEnd, context.width_m, context.depth_m, context.height_m, context.llmEstimate, onAddItem, dispatch]);
```

**Step 4: Add handleDone callback**

After `handleAddItem`:

```typescript
const handleDone = useCallback(() => {
  cleanup();
  dispatch({ type: 'END_SESSION' });
  onDone();
}, [cleanup, dispatch, onDone]);
```

**Step 5: Update MeasurementUI props in render**

In the render block (~line 971-984), replace `onFindStorage={handleFindStorage}` with:

```tsx
<MeasurementUI
  context={context}
  measurements={measurements}
  confidence={confidence}
  trackingWarning={trackingWarning}
  stabilityMode={stabilityMode}
  isManipulating={isManipulating}
  hasDepth={hasDepth}
  onReset={handleReset}
  onConfirmHeight={handleConfirmHeight}
  onAddItem={handleAddItem}
  onDone={handleDone}
  itemCount={itemCount}
  onSetStabilityMode={handleSetStabilityMode}
  onExit={handleExit}
/>
```

**Step 6: Verify build**

Run: `npm run build`
Expected: Will fail because MeasurementUI props don't match yet. That's OK — Task 4 fixes it.

**Step 7: Commit**

```bash
git add lib/three/scene-setup.ts components/ARSession.tsx
git commit -m "feat: update ARSession with addItem/done callbacks and thumbnail capture"
```

---

### Task 4: Update MeasurementUI with undo buttons and item counter

**Files:**
- Modify: `components/MeasurementUI.tsx`

**Step 1: Update MeasurementUIProps interface**

Replace `onFindStorage` with new props (lines 8-21):

```typescript
interface MeasurementUIProps {
  context: StateMachineContext;
  measurements: ComputedMeasurements | null;
  confidence: ConfidenceLevel | null;
  trackingWarning: string | null;
  stabilityMode: StabilityMode;
  isManipulating?: boolean;
  hasDepth?: boolean;
  onReset: () => void;
  onConfirmHeight: () => void;
  onAddItem: () => void;
  onDone: () => void;
  itemCount: number;
  onSetStabilityMode: (mode: StabilityMode) => void;
  onExit: () => void;
}
```

Update the destructuring (line 23-33):
```typescript
export default function MeasurementUI({
  context,
  measurements,
  confidence,
  trackingWarning,
  hasDepth,
  onReset,
  onConfirmHeight,
  onAddItem,
  onDone,
  itemCount,
  onExit,
}: MeasurementUIProps) {
```

**Step 2: Add item counter pill in top bar**

After the close button (inside the top bar `<div>`, before the floating dimension display ~line 107), add:

```tsx
{/* Item counter + Done button */}
{itemCount > 0 && (
  <div className="flex items-center gap-2">
    <span className="bg-black/50 backdrop-blur-sm text-white/80 px-3 py-1.5 rounded-full text-sm">
      {itemCount} item{itemCount !== 1 ? 's' : ''}
    </span>
    <button
      onClick={onDone}
      className="bg-blue-500 text-white px-3 py-1.5 rounded-full text-sm font-medium"
    >
      Done
    </button>
  </div>
)}
```

Remove the spacer div `<div className="w-9" />` — the counter replaces it. When `itemCount === 0`, add back the spacer:
```tsx
{itemCount === 0 && <div className="w-9" />}
```

**Step 3: Update AdjustmentPanel with Undo button**

Replace the `AdjustmentPanel` component (lines 260-280):

```tsx
function AdjustmentPanel({
  onConfirm,
  onUndo,
}: {
  onConfirm: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="p-3 flex gap-3">
      <button
        onClick={onUndo}
        onTouchEnd={(e) => { e.preventDefault(); onUndo(); }}
        className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
        style={{ touchAction: 'manipulation' }}
      >
        Undo
      </button>
      <button
        onClick={onConfirm}
        onTouchEnd={(e) => { e.preventDefault(); onConfirm(); }}
        className="flex-1 py-3 px-6 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
        style={{ touchAction: 'manipulation' }}
      >
        Confirm Dimensions
      </button>
    </div>
  );
}
```

Update where `AdjustmentPanel` is rendered (~line 183):
```tsx
{isHeightInput && (
  <AdjustmentPanel
    onConfirm={onConfirmHeight}
    onUndo={onReset}
  />
)}
```

**Step 4: Update ReviewPanel — rename "Find Storage" to "Add to List"**

In the `ReviewPanel` component (~line 300):
- Rename `onFindStorage` prop to `onAddItem`
- Change button text from "Find Storage" to "Add to List"

```tsx
function ReviewPanel({
  measurements,
  confidence,
  onRedo,
  onAddItem,
}: {
  measurements: ComputedMeasurements;
  confidence: ConfidenceLevel | null;
  onRedo: () => void;
  onAddItem: () => void;
}) {
```

In the action buttons section:
```tsx
<div className="flex gap-3">
  <button
    onClick={onRedo}
    className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
  >
    Undo
  </button>
  <button
    onClick={onAddItem}
    className="flex-1 py-3 px-4 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
  >
    Add to List
  </button>
</div>
```

Update where ReviewPanel is rendered (~line 188):
```tsx
{isReview && measurements && (
  <ReviewPanel
    measurements={measurements}
    confidence={confidence}
    onRedo={onReset}
    onAddItem={onAddItem}
  />
)}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add components/MeasurementUI.tsx
git commit -m "feat: add undo buttons, item counter, and Add to List in MeasurementUI"
```

---

### Task 5: Create ItemListView component

**Files:**
- Create: `components/ItemListView.tsx`
- Modify: `app/page.tsx` (remove placeholder, add import)

**Step 1: Create ItemListView.tsx**

Create `components/ItemListView.tsx` with:

- Props: `items: MeasuredItem[]`, `onDelete: (id: string) => void`, `onAddMore: () => void`, `onFindStorage: () => void`
- Header: "Your Items" with count
- Scrollable list of items, each with:
  - Thumbnail (60x60 rounded), dimensions in inches (W×D×H), volume in cu ft, X delete button
  - Tap to expand: larger thumbnail + detailed dims
- Footer: total volume, [Add More] and [Find Storage] buttons
- Empty state: "No items yet" with [Start Measuring] button
- Style: dark theme (`bg-gray-900`) matching existing pages

Key implementation details:
- Use `useState<string | null>` for `expandedId` to track which item is expanded inline
- Tap toggles expansion
- Delete uses `onDelete(item.id)`
- Volume formula: `(w_m * d_m * h_m) * 35.3147` for cu ft
- Inches: `meters * 39.3701`
- [Find Storage] disabled when `items.length === 0`

**Step 2: Update page.tsx — remove placeholder, add import**

In `app/page.tsx`:
- Remove the inline `ItemListView` placeholder
- Add: `import ItemListView from '@/components/ItemListView';`

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add components/ItemListView.tsx app/page.tsx
git commit -m "feat: add ItemListView curation component"
```

---

### Task 6: Update RadiusSlider to show items summary

**Files:**
- Modify: `components/RadiusSlider.tsx`

**Step 1: Add items prop**

Add `items?: MeasuredItem[]` to `RadiusSliderProps`. Import `MeasuredItem` from `@/lib/types`.

**Step 2: Show items summary above the slider**

After the header, before the slider, add a summary card when `items` is provided:

```tsx
{items && items.length > 0 && (
  <div className="bg-white/5 rounded-xl p-3 mb-4">
    <div className="text-white/60 text-xs mb-1">Measuring for</div>
    <div className="text-white font-medium">
      {items.length} item{items.length !== 1 ? 's' : ''} — {totalVol.toFixed(1)} cu ft
    </div>
  </div>
)}
```

Compute `totalVol` from items: `items.reduce((s, i) => s + i.width_m * i.depth_m * i.height_m, 0) * 35.3147`.

**Step 3: Pass items from page.tsx**

In `app/page.tsx`, add `items={measuredItems}` to the RadiusSlider render.

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add components/RadiusSlider.tsx app/page.tsx
git commit -m "feat: show items summary in RadiusSlider"
```

---

### Task 7: Update ResultsDisplay for multi-item

**Files:**
- Modify: `components/ResultsDisplay.tsx`

**Step 1: Add items prop**

Add `items?: MeasuredItem[]` to `ResultsDisplayProps`. Import `MeasuredItem` from `@/lib/types`.

**Step 2: Show per-item breakdown**

Above the facilities list, add an expandable "Your Items" section when `items` is provided:

```tsx
{items && items.length > 0 && (
  <div className="bg-white/5 rounded-xl p-4 mb-4">
    <div className="text-white/60 text-sm mb-2">Your items ({items.length})</div>
    {items.map(item => (
      <div key={item.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
        {item.thumbnail && (
          <img src={item.thumbnail} className="w-10 h-10 rounded object-cover" alt="" />
        )}
        <div className="text-white text-sm">
          {Math.round(item.width_m * 39.3701)}" × {Math.round(item.depth_m * 39.3701)}" × {Math.round(item.height_m * 39.3701)}"
        </div>
        <div className="text-white/40 text-xs ml-auto">
          {((item.width_m * item.depth_m * item.height_m) * 35.3147).toFixed(1)} ft³
        </div>
      </div>
    ))}
    <div className="text-white font-medium text-sm mt-2 pt-2 border-t border-white/10">
      Total: {items.reduce((s, i) => s + i.width_m * i.depth_m * i.height_m, 0) * 35.3147 |> (v => v.toFixed(1))} cu ft
    </div>
  </div>
)}
```

Note: Use a computed variable for total instead of the pipe operator (not supported). Calculate `totalCuFt` before the JSX.

**Step 3: Pass items from page.tsx**

In `app/page.tsx`, add `items={measuredItems}` to the ResultsDisplay render.

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add components/ResultsDisplay.tsx app/page.tsx
git commit -m "feat: show per-item breakdown in ResultsDisplay"
```

---

### Task 8: Final integration test and cleanup

**Step 1: Full build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Run linter**

Run: `npm run lint`
Expected: No lint errors.

**Step 3: Remove unused imports**

Check for unused `MeasurementData` imports in `page.tsx` and `ARSession.tsx`. Remove the `calculateMeasurementsFromLLM` import from ARSession if no longer used. Clean up any dead `measurementData` references.

**Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore: clean up unused imports from multi-item refactor"
```

**Step 5: Push**

```bash
git push origin walkaround
```
