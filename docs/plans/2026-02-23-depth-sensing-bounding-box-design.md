# Depth-Enhanced Tap: Auto-Sized Bounding Box via WebXR Depth Sensing

## Problem

Currently, tapping places a fixed 40cm cube that users must manually resize. The SHARP+SAM server approach works but requires a CUDA GPU server, adding latency and infrastructure cost. We need a fully client-side solution.

## Solution

Use the WebXR Depth Sensing API (shipped in Chrome for Android via ARCore) to read per-pixel depth maps. When the user taps on an object, sample the depth buffer to find the object's boundaries and auto-size the bounding box.

## Data Flow

```
User taps on object
  → Read depth at tap point (distance to object surface)
  → Flood-fill in depth buffer to find object region
  → Extract 2D extent of object in normalized view coords
  → Unproject boundary points to 3D world space
  → Fit gravity-aligned bounding box
  → Place box in scene (user can still adjust with handles)
```

## Files

### New
- `lib/webxr/depth-sensing.ts` — Depth API integration
- `lib/measurement/depth-box-fitting.ts` — Object boundary detection + box fitting

### Modified
- `lib/webxr/session-manager.ts` — Add depth-sensing feature
- `lib/webxr/render-loop.ts` — Pass depth info in frame data
- `components/ARSession.tsx` — Use depth to auto-size box on tap
- `lib/measurement/state-machine.ts` — Minor: handle depth estimation state

## Algorithm: Object Boundary Detection

1. Read center depth: `d_center = getDepthInMeters(tapX_norm, tapY_norm)`
2. Define depth tolerance: pixels within ±15cm of `d_center` = same object
3. Flood-fill from tap in depth buffer (BFS with tolerance check)
4. Extract min/max x/y in normalized view coordinates
5. Unproject edges to 3D using depth values + camera projection
6. Fit gravity-aligned box: width (X), depth (Z), height (Y)

## Fallback

If depth-sensing unavailable → current behavior (fixed 40cm box + manual resize).

## UX

Before: Tap → 40cm box → resize manually
After: Tap → auto-sized box → adjust if needed
