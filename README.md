# WebXR AR Measurement - Storage Finder

A web-based AR application for Android Chrome that lets users measure objects using WebXR and find suitable storage units.

## Features

- **WebXR AR Measurement**: Use your phone's camera to measure real-world objects
- **5-Point Measurement**: Tap 4 base corners + 1 height point for accurate W×D×H
- **Tap Stabilization**: Rolling window averaging ensures accurate point placement
- **Progressive Visualization**: See measurements build up as you tap points
- **Storage Search**: Find storage units that fit your measured object
- **Fit Logic**: Units are matched by direct dimension fit OR volume (with 1.25× padding)

## Requirements

- **Android phone** with ARCore support (most phones from 2018+)
- **Chrome** browser (latest version recommended)
- **HTTPS** connection (required for WebXR)
- **Camera permission** enabled

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
3. **Measure**:
   - Point at a flat surface until the reticle turns green (stable)
   - Tap 4 corners of the object's base (front-left → front-right → back-right → back-left)
   - Tap the top of the object for height
4. **Review**: Check the measurements and confidence level
5. **Find Storage**: Set search radius and find matching storage units

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
│   │   ├── markers.ts          # Point markers and lines
│   │   └── bounding-box.ts     # Translucent measurement box
│   └── measurement/
│       ├── state-machine.ts    # Measurement state management
│       ├── stabilization.ts    # Pose stabilization
│       ├── geometry.ts         # Rectangle fitting, plane math
│       └── calculations.ts     # W/D/H/volume computations
└── public/
    └── manifest.json           # PWA manifest
```

## Measurement Math

### Rectangle Fitting
1. Use P1→P2 as the width direction
2. Compute plane normal from first 3 points
3. Derive depth direction perpendicular to width (in plane)
4. Project all 4 points onto width/depth axes
5. Width = extent along width axis, Depth = extent along depth axis

### Height Calculation
1. Compute base plane from 4 base points
2. Height = vertical distance from base centroid to height point
3. Uses local-floor reference space for Y-axis alignment

### Stabilization
- Rolling window of last 10 hit-test positions
- Variance threshold: 5mm maximum spread
- Taps only accepted when variance is below threshold
- Visual feedback: green reticle = stable, orange = unstable

### Confidence Indicator
- **HIGH**: Stability > 80%, orthogonality error < 5°
- **MEDIUM**: Stability > 50%, orthogonality error < 15°
- **LOW**: Otherwise

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

### "WebXR not available"
- Ensure you're using Chrome on Android
- Check that you're accessing via HTTPS
- Try chrome://flags and enable "WebXR Incubations"

### "Immersive AR not supported"
- Your device may not support ARCore
- Install "Google Play Services for AR" from Play Store
- Check [ARCore supported devices](https://developers.google.com/ar/devices)

### "Hit-test not working"
- Point at a flat, textured surface
- Ensure adequate lighting
- Move the phone slowly to improve tracking

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
