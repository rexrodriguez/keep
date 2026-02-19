# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

```
keep/
├── packages/
│   ├── web/           ← Next.js 14 + Three.js AR app
│   └── sharp-server/  ← Python FastAPI server (SHARP geometric measurement)
├── package.json       ← npm workspace root
└── CLAUDE.md
```

## Build & Development Commands

```bash
# From repo root:
npm install              # Install all workspace dependencies
npm run dev              # Start Next.js dev server with HTTPS (WebXR requires HTTPS)
npm run build            # Production build

# Next.js app directly (from packages/web/):
npm run dev:https        # HTTPS dev server
npm run build

# Python server (from packages/sharp-server/):
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Testing on device**: Access `https://YOUR_IP:3000` from Android Chrome on same network. Accept self-signed cert warning.

**Environment**: Copy `packages/web/.env.example` to `packages/web/.env.local` and set:
- `SHARP_SERVER_URL=http://localhost:8000` (or cloud GPU URL)

## Architecture Overview

This is a WebXR AR web app (Next.js 14 + Three.js) for measuring objects and finding storage units.

### Data Flow

1. **Capability Detection** (`packages/web/lib/webxr/capability-check.ts`) → Validates HTTPS, WebXR API, immersive-ar, hit-test, local-floor
2. **AR Session** (`packages/web/lib/webxr/session-manager.ts`) → Manages XRSession lifecycle with Three.js renderer
3. **Hit-Test Loop** (`packages/web/lib/webxr/render-loop.ts`) → Frame-by-frame surface detection via `frame.getHitTestResults()`
4. **Stabilization** (`packages/web/lib/measurement/stabilization.ts`) → Rolling window (5 frames) filters noisy poses; variance threshold 15mm
5. **State Machine** (`packages/web/lib/measurement/state-machine.ts`) → Drives UI through: `READY_TO_DRAW → READY_TO_MEASURE → HEIGHT_INPUT → REVIEW → RESULTS`

### Measurement Approach (Two-Step)

1. **Step 1 — Set base**: User taps a flat surface. WebXR hit-test gives the surface pose. The raw hit matrix (col-major Float32Array) is stored as `baseHitMatrix` in state.
2. **Step 2 — Measure object**: User taps the object. App captures:
   - Camera frame (JPEG, max 800px wide)
   - `view.transform.matrix` (camera-to-world, col-major)
   - `view.projectionMatrix` (col-major)
   - Base plane hit matrix
   - Tap pixel in JPEG-space coordinates
3. All sent to `POST /api/estimate-dimensions` which proxies to the Python SHARP server.
4. Python server runs SHARP → 3D point cloud → gravity-aligned box fitting → returns `{ width_cm, depth_cm, height_cm, confidence }`.

### Key Integration Points

- **`packages/web/components/ARSession.tsx`** — orchestrates WebXR + Three.js + state machine + UI overlay
- **`packages/web/app/page.tsx`** — manages top-level app state
- **`packages/web/app/api/estimate-dimensions/route.ts`** — thin proxy to Python server
- **`packages/sharp-server/main.py`** — FastAPI endpoint
- **`packages/sharp-server/sharp_runner.py`** — SHARP model wrapper → world-space point cloud
- **`packages/sharp-server/geometry.py`** — ray unprojection, plane filtering, bounding box fitting

### Storage API

`POST /api/storage-search` with dimensions returns mock facilities. Fit logic: direct dimension match OR `unit_volume >= object_volume × 1.25`.

## WebXR Specifics

- Requires `requiredFeatures: ['hit-test', 'local-floor']`
- Optional: `camera-access` (needed for SHARP server)
- Uses `dom-overlay` for HTML UI over camera feed
- All measurements in meters (WebXR native); converted to cm/inches for display
- Reticle color indicates stability: green = stable (can tap), orange = unstable
- `view.transform.matrix` is **column-major, camera-to-world, Y-up, Z-back, right-handed**
- SHARP output uses OpenCV convention (Y-down, Z-forward); conversion: `pts *= [1, -1, -1]`

## Python Server (SHARP)

- Requires CUDA GPU for practical inference speed (~1s on A100)
- Deploy via Docker: `docker build -t keep-sharp . && docker run --gpus all -p 8000:8000 keep-sharp`
- Model weights auto-download from Apple CDN on first run (~checkpoint.pt)
- Python 3.13, PyTorch 2.8, CUDA 12.8
