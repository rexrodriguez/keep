# WebXR AR Measurement - Storage Finder

A web-based AR application for Android Chrome that lets users measure objects using WebXR and find suitable storage units.

## Features

- **WebXR AR Measurement**: Use your phone's camera to measure real-world objects
- **Tap-to-Place**: Single tap places a measurement box on detected floor surfaces
- **Direct Manipulation**: Drag arrow handles to resize, rotate, and move the box
  - **Edge arrows** (cyan): Drag to adjust width and depth
  - **Top arrow** (purple): Drag up/down to adjust height
  - **Top corner arcs** (purple): Drag to rotate the box
  - **Bottom corner arrows** (cyan): Drag to move the entire box
- **Reticle-Based Targeting**: Aim the reticle at handles for best interaction accuracy
- **Storage Search**: Find storage units that fit your measured object nearby
- **Fit Logic**: Units matched by direct dimension fit OR volume (with 1.25× padding)

## Requirements

- **Android phone** with ARCore support (most phones from 2018+)
- **Chrome** browser (version 79+ recommended)
- **HTTPS** connection (required for WebXR)
- **Camera permission** enabled
- **Google Play Services for AR** installed (usually automatic)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Development Server with HTTPS

Next.js 14 includes experimental HTTPS support:

```bash
npm run dev:https
```

This will generate a self-signed certificate and start the server.

**Alternative**: Use a tool like `mkcert` for trusted local certificates:

```bash
# Install mkcert (macOS)
brew install mkcert
mkcert -install

# Generate certificates
mkcert localhost 192.168.x.x  # Replace with your local IP

# Run with custom certs
npx next dev --experimental-https
```

### 3. Access from Android Phone

1. Find your computer's local IP address:
   ```bash
   # macOS/Linux
   ifconfig | grep "inet "
   # Windows
   ipconfig
   ```

2. Ensure your phone is on the same WiFi network

3. Open Chrome on your Android phone and navigate to:
   ```
   https://YOUR_COMPUTER_IP:3000
   ```

4. Accept the certificate warning (tap "Advanced" → "Proceed")

5. Grant camera permission when prompted

### WSL2 Setup (Windows Subsystem for Linux)

When running from WSL2, your Android phone can't directly reach the WSL2 network. You need to forward the port from Windows.

#### Step 1: Get your WSL2 IP address

In WSL2 terminal:
```bash
hostname -I | awk '{print $1}'
```
Example output: `172.25.123.45`

#### Step 2: Set up port forwarding (run in PowerShell as Administrator)

```powershell
# Replace <WSL2_IP> with your actual WSL2 IP from Step 1
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<WSL2_IP>

# Example:
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=172.25.123.45
```

#### Step 3: Allow the port through Windows Firewall (PowerShell as Administrator)

```powershell
New-NetFirewallRule -DisplayName "WSL2 Port 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

#### Step 4: Get your Windows host IP

In PowerShell or CMD:
```powershell
ipconfig
```
Look for your WiFi or Ethernet adapter's IPv4 address (e.g., `192.168.1.100`)

#### Step 5: Access from your phone

Open Chrome on your Android phone and navigate to:
```
https://YOUR_WINDOWS_IP:3000
```
(e.g., `https://192.168.1.100:3000`)

#### Cleanup (when done)

Remove the port forwarding rule:
```powershell
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0
```

Remove the firewall rule:
```powershell
Remove-NetFirewallRule -DisplayName "WSL2 Port 3000"
```

#### Note on WSL2 IP changes

WSL2 IP addresses change on restart. If the connection stops working after a reboot, repeat Steps 1-2 with the new WSL2 IP.

### 4. Use the App

1. **Capability Check**: App verifies your device supports WebXR AR
2. **Start AR**: Tap "Start AR Measurement"
3. **Place Box**: Point at the floor until a surface is detected, then tap to place a measurement box
4. **Adjust Dimensions**: Aim the reticle at the arrow handles and drag to resize:
   - Drag **edge arrows** to adjust width/depth
   - Drag the **top arrow** up/down for height
   - Drag **top corner arcs** to rotate
   - Drag **bottom corner arrows** to move the box
5. **Confirm & Search**: Tap "Looks Good" then set search radius to find matching storage units

**Tip**: For best results, aim the center reticle at the handle you want to manipulate before dragging.

## Project Structure

```
├── app/
│   ├── layout.tsx              # Root layout with meta tags
│   ├── page.tsx                # Main page with app state management
│   ├── globals.css             # Global styles
│   └── api/
│       └── storage-search/
│           └── route.ts        # Mock storage API with fit logic
├── components/
│   ├── CapabilityCheck.tsx     # Device capability detection UI
│   ├── ARSession.tsx           # WebXR session management
│   ├── MeasurementUI.tsx       # AR overlay UI
│   ├── RadiusSlider.tsx        # Search radius selector
│   └── ResultsDisplay.tsx      # Storage results cards
├── lib/
│   ├── types.ts                # TypeScript interfaces
│   ├── webxr/
│   │   ├── capability-check.ts # WebXR capability detection
│   │   ├── session-manager.ts  # XR session lifecycle
│   │   ├── hit-test.ts         # Hit-test processing
│   │   └── render-loop.ts      # XR frame loop
│   ├── three/
│   │   ├── scene-setup.ts      # Three.js scene configuration
│   │   ├── reticle.ts          # AR reticle mesh
│   │   ├── bounding-box.ts     # Measurement box with handles
│   │   ├── handle-raycasting.ts # Touch-to-handle hit detection
│   │   └── target-marker.ts    # Floor target indicator
│   └── measurement/
│       ├── state-machine.ts    # Measurement state management
│       ├── stabilization.ts    # Pose stabilization
│       └── calculations.ts     # W/D/H/volume computations
└── public/
    └── manifest.json           # PWA manifest
```

## Interaction Model

### Direct Manipulation
The app uses a direct manipulation paradigm where users interact with visible arrow handles:

- **Edge Arrows**: Cyan arrows on each face control width (left/right) and depth (front/back)
- **Top Arrow**: Purple upward arrow controls height
- **Top Corner Arcs**: Purple curved arrows at top corners control rotation
- **Bottom Corner Arrows**: Cyan four-way arrows at bottom corners move the entire box

### Reticle-Based Targeting
For best accuracy, aim the center reticle at the handle you want to manipulate. The system uses raycasting from your touch position, but having the reticle aligned with the handle improves hit detection.

### Stabilization
- Rolling window of last 5 hit-test positions
- Variance threshold: 15mm maximum spread for placement
- Visual feedback: green reticle = stable (can place), orange = unstable

## API

### POST /api/storage-search

Request:
```json
{
  "width_cm": 60,
  "depth_cm": 40,
  "height_cm": 50,
  "volume_m3": 0.12,
  "radius_km": 5,
  "user_location": { "lat": 37.7749, "lng": -122.4194 },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

Response:
```json
{
  "facilities": [
    {
      "id": "fac-1",
      "name": "SecureStore Downtown",
      "address": "123 Main St",
      "distance_km": 2.3,
      "rating": 4.5,
      "units": [
        {
          "id": "u1-1",
          "name": "5x5 Small",
          "width_cm": 152,
          "depth_cm": 152,
          "height_cm": 244,
          "volume_m3": 5.6,
          "price_monthly": 59,
          "available": true
        }
      ]
    }
  ],
  "object_dimensions": {
    "width_cm": 60,
    "depth_cm": 40,
    "height_cm": 50,
    "volume_m3": 0.12
  }
}
```

### Fit Logic
A storage unit fits if:
- Direct fit: `unit_W >= obj_W AND unit_D >= obj_D AND unit_H >= obj_H`
- OR Volume fit: `unit_volume >= obj_volume × 1.25`

## Troubleshooting

### Chrome Flags (if AR isn't working)

On most modern Android devices (Chrome 79+), WebXR AR works without any flags. If you experience issues, try enabling these in `chrome://flags`:

1. **WebXR Device API** (`#webxr`) - Usually enabled by default
2. **WebXR Incubations** (`#webxr-incubations`) - Enables experimental features
3. **WebXR AR Module** (`#webxr-ar-module`) - AR-specific features (if available)

After changing flags, restart Chrome completely.

### "WebXR not available"
- Ensure you're using Chrome on Android (not Firefox, Samsung Browser, etc.)
- Check that you're accessing via HTTPS
- Try enabling flags listed above

### "Immersive AR not supported"
- Your device may not support ARCore
- Install "Google Play Services for AR" from Play Store
- Check [ARCore supported devices](https://developers.google.com/ar/devices)

### "Hit-test not working" / Reticle not appearing
- Point at a flat, textured surface (plain white surfaces are hard to track)
- Ensure adequate lighting
- Move the phone slowly to help ARCore build a map
- Try pointing at the floor from different angles

### Handles not responding to touch
- Aim the center reticle directly at the arrow handle before dragging
- The reticle helps the system know which handle you're targeting
- Make sure you're in the adjustment phase (after placing the box)

### Certificate warnings
- Expected with self-signed certificates
- Tap "Advanced" → "Proceed to site"
- For trusted certs, use `mkcert` as described above

## Tech Stack

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **Three.js** - 3D rendering
- **Tailwind CSS** - Styling
- **WebXR Device API** - AR capabilities

## License

MIT
