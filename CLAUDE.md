# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev:https    # Development server with HTTPS (required for WebXR)
npm run dev          # Development server (HTTP only, won't work for AR)
npm run build        # Production build
npm run lint         # ESLint
```

**Testing on device**: Access `https://YOUR_IP:3000` from Android Chrome on same network. Accept self-signed cert warning.

## Architecture Overview

This is a WebXR AR web app (Next.js 14 + Three.js) for measuring objects and finding storage units.

### Data Flow

1. **Capability Detection** (`lib/webxr/capability-check.ts`) → Validates HTTPS, WebXR API, immersive-ar, hit-test, local-floor
2. **AR Session** (`lib/webxr/session-manager.ts`) → Manages XRSession lifecycle with Three.js renderer
3. **Hit-Test Loop** (`lib/webxr/render-loop.ts`) → Frame-by-frame surface detection via `frame.getHitTestResults()`
4. **Stabilization** (`lib/measurement/stabilization.ts`) → Rolling window (5 frames) filters noisy poses; variance threshold 15mm
5. **State Machine** (`lib/measurement/state-machine.ts`) → Drives UI through: `FLOOR_1→FLOOR_2→HEIGHT_INPUT→REVIEW→RESULTS`

### Measurement Approach

**Important**: WebXR hit-test only detects flat surfaces (floor, table, walls). It cannot detect arbitrary 3D points in space. The measurement flow is:
1. Two floor taps capture width and depth from X/Z coordinates
2. Height is set manually via slider (user estimates object height)
3. This approach works because surfaces are the only thing hit-test can reliably detect

### Key Integration Points

- **ARSession.tsx** orchestrates WebXR + Three.js + state machine + UI overlay
- **app/page.tsx** manages top-level app state (`CHECKING→READY→AR_ACTIVE→RADIUS_SELECT→RESULTS`)
- Three.js objects (reticle, markers, bounding box) live in `lib/three/`; updated each frame from hit-test data

### Storage API

`POST /api/storage-search` with dimensions returns mock facilities. Fit logic: direct dimension match OR `unit_volume >= object_volume × 1.25`.

## WebXR Specifics

- Requires `requiredFeatures: ['hit-test', 'local-floor']`
- Uses `dom-overlay` for HTML UI over camera feed
- All measurements in meters (WebXR native); converted to cm/inches for display
- Reticle color indicates stability: green = stable (can tap), orange = unstable
