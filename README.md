# Keep — AR Object Measurement + Storage Finder

A WebXR AR app that measures real-world objects using geometric 3D reconstruction (SHARP) and finds storage units that fit.

## Architecture

```
keep/
├── packages/
│   ├── web/              Next.js 14 + Three.js AR client
│   └── sharp-server/     Python FastAPI + SHARP geometric measurement
├── package.json          npm workspace root
└── CLAUDE.md
```

**How measurement works:**
1. User taps a flat surface → establishes base plane (hit-test pose matrix stored)
2. User taps an object → camera frame captured with XR view/projection matrices + tap pixel
3. Payload sent to SHARP server → monocular 3D reconstruction → gravity-aligned bounding box
4. Dimensions returned, box rendered in AR for manual adjustment

## Requirements

- **Android phone** with ARCore support (most phones from 2018+)
- **Chrome** browser (v79+)
- **HTTPS** (required for WebXR)
- **SHARP server** running on a CUDA GPU (for geometric measurement)

## Quick Start — Development on Local WiFi

### 1. Install & start the Next.js app

```bash
npm install
npm run dev
```

This starts the HTTPS dev server at `https://localhost:3000` (self-signed cert auto-generated).

### 2. Start the SHARP server

On a machine with a CUDA GPU (can be the same machine or a cloud instance):

```bash
cd packages/sharp-server
./setup.sh                            # creates .venv, installs deps
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or manually:

```bash
cd packages/sharp-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or with Docker:

```bash
cd packages/sharp-server
docker build -t keep-sharp .
docker run --gpus all -p 8000:8000 keep-sharp
```

### 3. Configure the connection

Copy `packages/web/.env.example` to `packages/web/.env.local`:

```bash
cp packages/web/.env.example packages/web/.env.local
```

Edit `packages/web/.env.local`:

```env
# If SHARP server runs on the same machine:
SHARP_SERVER_URL=http://localhost:8000

# If SHARP server runs on a cloud GPU:
SHARP_SERVER_URL=https://your-gpu-instance.example.com:8000
```

### 4. Access from your Android phone

Find your development machine's local IP:

```bash
# macOS/Linux
hostname -I | awk '{print $1}'
# or
ifconfig | grep "inet "
```

On your Android phone (same WiFi network), open Chrome:

```
https://YOUR_COMPUTER_IP:3000
```

Accept the self-signed certificate warning (Advanced → Proceed).

### WSL2 Setup (Windows)

WSL2 runs in a separate network — your phone can't reach it directly. Forward the port from Windows:

**Step 1** — Get your WSL2 IP (in WSL2 terminal):
```bash
hostname -I | awk '{print $1}'
```

**Step 2** — Forward port 3000 (PowerShell as Administrator):
```powershell
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<WSL2_IP>
```

**Step 3** — Allow through Windows Firewall (PowerShell as Administrator):
```powershell
New-NetFirewallRule -DisplayName "WSL2 Port 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

**Step 4** — Get your Windows host IP (PowerShell):
```powershell
ipconfig
```
Use the WiFi/Ethernet adapter's IPv4 address (e.g., `192.168.1.100`).

**Step 5** — On your phone, navigate to `https://YOUR_WINDOWS_IP:3000`

**If SHARP server also runs in WSL2**, forward port 8000 too:
```powershell
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=<WSL2_IP>
New-NetFirewallRule -DisplayName "WSL2 Port 8000" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

**Cleanup** (when done):
```powershell
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0
netsh interface portproxy delete v4tov4 listenport=8000 listenaddress=0.0.0.0
Remove-NetFirewallRule -DisplayName "WSL2 Port 3000"
Remove-NetFirewallRule -DisplayName "WSL2 Port 8000"
```

Note: WSL2 IP changes on restart — repeat steps 1-2 with the new IP.

## Using the App

1. **Start AR** → Tap "Start AR Measurement"
2. **Set base** → Point at a flat surface, tap when reticle is green
3. **Measure** → Point at the object, tap to capture and estimate dimensions
4. **Adjust** → Use mode controls (move / rotate / resize) to refine the box
5. **Find storage** → Tap "Looks Good" then search for matching storage units

## Project Structure

```
packages/web/
├── app/
│   ├── page.tsx                    Top-level app state
│   └── api/
│       ├── estimate-dimensions/    Proxy to SHARP server
│       └── storage-search/         Mock storage search API
├── components/
│   ├── ARSession.tsx               WebXR + Three.js + state machine
│   ├── MeasurementUI.tsx           AR overlay UI
│   └── ModeSelector.tsx            Move/rotate/resize mode switcher
└── lib/
    ├── webxr/
    │   ├── session-manager.ts      XR session lifecycle
    │   ├── render-loop.ts          Frame loop (hit-test, view matrices)
    │   ├── hit-test.ts             Surface detection + raw pose matrix
    │   └── camera-capture.ts       XR camera frame → JPEG
    ├── three/
    │   ├── bounding-box.ts         Measurement box with handles
    │   ├── base-grid.ts            Base plane wireframe
    │   └── reticle.ts              AR targeting reticle
    └── measurement/
        ├── state-machine.ts        READY_TO_DRAW → READY_TO_MEASURE → HEIGHT_INPUT → REVIEW
        ├── stabilization.ts        Pose averaging (5-frame window, 15mm variance)
        └── calculations.ts         Dimension conversion

packages/sharp-server/
├── main.py                         FastAPI endpoint (POST /estimate)
├── sharp_runner.py                 SHARP model → world-space point cloud
├── geometry.py                     Ray unproject, plane filter, box fitting
├── requirements.txt                Python 3.13, PyTorch 2.8, CUDA 12.8
└── Dockerfile                      Cloud GPU deployment
```

## API

### POST /api/estimate-dimensions (Next.js → SHARP server proxy)

The client sends an enriched payload with geometric data:

```json
{
  "imageJpegBase64": "...",
  "imageSize": { "width": 800, "height": 450 },
  "camera": {
    "viewMatrix_c2w_colMajor": [16 floats],
    "projectionMatrix_colMajor": [16 floats]
  },
  "plane": {
    "hitMatrix_colMajor": [16 floats],
    "normal_world": [0, 1, 0],
    "point_world": [x, y, z]
  },
  "selection": {
    "type": "tap",
    "pixel": { "x": 400, "y": 225 }
  }
}
```

Response:
```json
{
  "success": true,
  "estimate": {
    "width_cm": 60.0,
    "depth_cm": 40.0,
    "height_cm": 50.0,
    "confidence": "HIGH",
    "objectDescription": "Geometric measurement via SHARP"
  }
}
```

### POST /api/storage-search

Request:
```json
{
  "width_cm": 60,
  "depth_cm": 40,
  "height_cm": 50,
  "volume_m3": 0.12,
  "radius_km": 5
}
```

A storage unit fits if:
- Direct fit: `unit_W >= obj_W AND unit_D >= obj_D AND unit_H >= obj_H`
- OR Volume fit: `unit_volume >= obj_volume × 1.25`

## Troubleshooting

### "WebXR not available"
- Use Chrome on Android (not Firefox or Samsung Browser)
- Must be accessed via HTTPS
- Try enabling `chrome://flags/#webxr-incubations`

### Reticle not appearing
- Point at a flat, textured surface (plain white is hard to track)
- Move slowly so ARCore can build a map
- Ensure adequate lighting

### SHARP server errors
- Check `SHARP_SERVER_URL` is set in `.env.local`
- Verify the server is reachable: `curl http://localhost:8000/health`
- First run downloads model weights (~1GB) — allow time for this

### Certificate warnings
- Expected with self-signed certs — tap Advanced → Proceed
- For trusted certs, use `mkcert` to generate local CA certs

## Tech Stack

- **Next.js 14** — React framework with App Router
- **Three.js** — 3D rendering
- **WebXR Device API** — AR session, hit-test, camera access
- **FastAPI** — Python server for SHARP inference
- **SHARP** (Apple) — Single-image 3D Gaussian reconstruction
- **Tailwind CSS** — Styling
- **TypeScript** — Type safety

## License

MIT
