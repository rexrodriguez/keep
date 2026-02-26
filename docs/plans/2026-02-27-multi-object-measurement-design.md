# Multi-Object Measurement Design

## Overview

Replace the single-object measurement flow with a multi-object flow where users measure multiple items, curate a list, and search for storage that fits everything.

## App Flow

```
LANDING → CHECKING → READY → AR_ACTIVE → ITEM_LIST → RADIUS_SELECT → RESULTS
                                ↑              |
                                └──────────────┘  ("Add More")
```

## Data Model

New type in `lib/types.ts`:

```typescript
export interface MeasuredItem {
  id: string;              // crypto.randomUUID()
  width_m: number;
  depth_m: number;
  height_m: number;
  confidence: ConfidenceLevel;
  thumbnail: string;       // base64 JPEG from canvas capture
  addedAt: number;         // Date.now()
}
```

State in `page.tsx`:
- `measuredItems: MeasuredItem[]` replaces `measurementData: MeasurementData | null`
- New `AppState` value: `ITEM_LIST`

## AR Session Changes

### Callbacks
- `onFindStorage(data)` → replaced by `onAddItem(item: MeasuredItem)` and `onDone()`
- ARSession receives `itemCount: number` prop (for displaying counter in overlay)

### After "Add to List"
- State machine dispatches `RESET` → goes to `READY_TO_DRAW`
- User re-locks floor each time (handles different elevations)

### Thumbnail Capture
- At REVIEW state entry, capture `renderer.domElement.toDataURL('image/jpeg', 0.5)`
- Store as base64 string, passed up via `onAddItem`
- Requires `preserveDrawingBuffer: true` on WebGL renderer (or capture in render loop)

### MeasurementUI Changes

**HEIGHT_INPUT panel** (AdjustmentPanel):
```
[Undo]  [Confirm Dimensions]
```
- "Undo" calls `onReset` (back to FLOOR_LOCKED)

**REVIEW panel** (ReviewPanel):
```
[Undo]  [Add to List]
```
- "Undo" calls `onRedo` (back to FLOOR_LOCKED, re-measure)
- "Add to List" calls `onAddItem` with current dimensions + thumbnail

**Item counter pill** (top bar, when items > 0):
```
[3 items]  [Done ✓]
```
- "Done" calls `onDone` (exits AR → ITEM_LIST)

## New Component: ItemListView

Full-screen curation view between AR and RADIUS_SELECT.

### Layout
- Header: "Your Items" + count
- Scrollable item list
- Footer: total volume + action buttons

### Item Row
- Thumbnail (small, ~60x60px)
- Dimensions: W × D × H in inches
- Volume in cu ft
- Delete button (X)
- Tap to expand inline: larger thumbnail + detailed dimensions

### Footer
- Total volume (sum of all items)
- `[Add More]` → back to AR_ACTIVE
- `[Find Storage]` → to RADIUS_SELECT (disabled if 0 items)

### Empty State
- "No items measured yet"
- `[Start Measuring]` → back to AR_ACTIVE

## Storage Search Changes

### RadiusSlider
- Receives `items: MeasuredItem[]` instead of single `MeasurementData`
- Shows summary: "N items, X.X cu ft total"

### API Request
- Sends total volume (sum of all item volumes)
- Uses largest single item dimensions for fit check

### ResultsDisplay
- Shows per-item breakdown (thumbnail + dims)
- Shows total volume
- `onNewMeasurement` → back to ITEM_LIST (not AR)

## Files Changed

1. `lib/types.ts` — Add `MeasuredItem` interface
2. `app/page.tsx` — Add `ITEM_LIST` state, `measuredItems[]`, new callbacks
3. `components/ARSession.tsx` — Change callbacks, add canvas capture, pass item count
4. `components/MeasurementUI.tsx` — Undo buttons, item counter pill, rename "Find Storage" to "Add to List"
5. `components/ItemListView.tsx` — New component (curation screen)
6. `components/RadiusSlider.tsx` — Accept items array, show summary
7. `components/ResultsDisplay.tsx` — Show per-item breakdown
8. `lib/measurement/calculations.ts` — Add multi-item volume helpers
