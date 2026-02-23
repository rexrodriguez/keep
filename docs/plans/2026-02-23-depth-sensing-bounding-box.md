# Depth-Enhanced Tap: Auto-Sized Bounding Box Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fixed 40cm box placement with depth-sensing-driven auto-sizing — tap on an object, the depth map determines its boundaries, and a properly-sized bounding box appears.

**Architecture:** Add WebXR Depth Sensing API integration as an optional feature. On tap, read the depth buffer to find the object's 2D silhouette via flood-fill, unproject boundary points to 3D world space using depth values + camera projection, and fit a gravity-aligned bounding box. Falls back to current fixed-size box if depth unavailable.

**Tech Stack:** TypeScript, WebXR Depth Sensing API (XRCPUDepthInformation), Three.js, Next.js 14

**Note:** No test framework exists in this project. WebXR features require a physical Android device with Chrome. Testing is manual on-device via `npm run dev:https` and accessing `https://YOUR_IP:3000`.

---

## Task 1: Add Depth Sensing to Session Manager

**Files:**
- Modify: `lib/webxr/session-manager.ts`

**Step 1: Add depth-sensing to session features and context**

In `lib/webxr/session-manager.ts`, make these changes:

1. Add `depthSensing` field to `XRSessionContext` interface:

```typescript
export interface XRSessionContext {
  session: XRSession;
  localFloorSpace: XRReferenceSpace;
  viewerSpace: XRReferenceSpace;
  hitTestSource: XRHitTestSource | null;
  renderer: THREE.WebGLRenderer;
  glBinding: XRWebGLBinding | null;
  hasCameraAccess: boolean;
  hasDepthSensing: boolean;  // NEW
}
```

2. Add `depth-sensing` to `optionalFeatures` array (line 24):

```typescript
const optionalFeatures: string[] = ['camera-access', 'depth-sensing'];
```

3. Add `depthSensing` configuration to `sessionInit` (after line 31):

```typescript
const sessionInit: XRSessionInit = {
  requiredFeatures: ['hit-test', 'local-floor'],
  optionalFeatures,
  depthSensing: {
    usagePreference: ['cpu-optimized'],
    dataFormatPreference: ['luminance-alpha', 'float32'],
  },
} as any; // XRSessionInit type doesn't include depthSensing yet
```

4. After session creation, check if depth sensing was granted:

```typescript
let hasDepthSensing = false;
try {
  hasDepthSensing = !!(session as any).depthUsage;
  if (hasDepthSensing) {
    console.log('WebXR depth sensing available:', (session as any).depthUsage, (session as any).depthDataFormat);
  }
} catch {
  console.warn('WebXR depth sensing not available');
}
```

5. Include `hasDepthSensing` in the returned context.

**Step 2: Build and verify**

Run: `npm run build`
Expected: No TypeScript errors. The session now requests depth-sensing as optional.

**Step 3: Commit**

```bash
git add lib/webxr/session-manager.ts
git commit -m "feat: request depth-sensing as optional WebXR feature"
```

---

## Task 2: Create Depth Sensing Module

**Files:**
- Create: `lib/webxr/depth-sensing.ts`

**Step 1: Create the depth sensing helper module**

Create `lib/webxr/depth-sensing.ts` with:

```typescript
/**
 * WebXR Depth Sensing API helpers.
 *
 * Extracts XRCPUDepthInformation from each frame and provides
 * utilities to read depth at specific screen coordinates.
 */

import * as THREE from 'three';

/**
 * Depth data extracted from a single XR frame.
 * null if depth sensing is unavailable.
 */
export interface DepthData {
  /** Raw XRCPUDepthInformation object */
  depthInfo: any; // XRCPUDepthInformation (not in TS types yet)
  /** Depth buffer width */
  width: number;
  /** Depth buffer height */
  height: number;
}

/**
 * Extract CPU depth information from an XR frame.
 * Returns null if depth sensing is unavailable or fails.
 */
export function getDepthData(
  frame: XRFrame,
  referenceSpace: XRReferenceSpace
): DepthData | null {
  try {
    const pose = frame.getViewerPose(referenceSpace);
    if (!pose || pose.views.length === 0) return null;

    const view = pose.views[0];
    const depthInfo = (frame as any).getDepthInformation?.(view);
    if (!depthInfo) return null;

    return {
      depthInfo,
      width: depthInfo.width,
      height: depthInfo.height,
    };
  } catch {
    return null;
  }
}

/**
 * Read depth in meters at normalized view coordinates (0-1 range).
 * x=0 is left, x=1 is right. y=0 is top, y=1 is bottom.
 * Returns 0 if no depth data at that point.
 */
export function getDepthAtNormalized(
  depthData: DepthData,
  normX: number,
  normY: number
): number {
  try {
    const d = depthData.depthInfo.getDepthInMeters(normX, normY);
    return d ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Read depth at a screen pixel coordinate.
 * Converts pixel (x, y) to normalized view coords and reads depth.
 */
export function getDepthAtPixel(
  depthData: DepthData,
  pixelX: number,
  pixelY: number,
  viewportWidth: number,
  viewportHeight: number
): number {
  const normX = pixelX / viewportWidth;
  const normY = pixelY / viewportHeight;
  return getDepthAtNormalized(depthData, normX, normY);
}

/**
 * Read the raw depth buffer as a 2D Float32Array for bulk operations.
 * Each value is depth in meters. 0 means no data.
 * Returns null if unable to read the buffer.
 */
export function getDepthBuffer(depthData: DepthData): Float32Array | null {
  try {
    const { depthInfo } = depthData;
    const { width, height, rawValueToMeters } = depthInfo;
    const buffer = new Float32Array(width * height);

    // Read raw data and convert to meters
    const rawData = depthInfo.data as ArrayBuffer;
    const dataFormat = depthInfo.dataFormat || 'luminance-alpha';

    if (dataFormat === 'float32' || rawData.byteLength === width * height * 4) {
      // Float32 format
      const float32 = new Float32Array(rawData);
      for (let i = 0; i < float32.length; i++) {
        buffer[i] = float32[i] * rawValueToMeters;
      }
    } else {
      // Luminance-alpha (Uint16) format - most common on Android
      const uint16 = new Uint16Array(rawData);
      for (let i = 0; i < uint16.length; i++) {
        buffer[i] = uint16[i] * rawValueToMeters;
      }
    }

    return buffer;
  } catch (e) {
    console.warn('Failed to read depth buffer:', e);
    return null;
  }
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build. Module only imported when used.

**Step 3: Commit**

```bash
git add lib/webxr/depth-sensing.ts
git commit -m "feat: add depth sensing module for reading XRCPUDepthInformation"
```

---

## Task 3: Pass Depth Data Through Render Loop

**Files:**
- Modify: `lib/webxr/render-loop.ts`

**Step 1: Add depth data to FrameData and pass it through**

1. Import the depth module:
```typescript
import { DepthData, getDepthData } from './depth-sensing';
```

2. Add `depthData` to `FrameData` interface:
```typescript
export interface FrameData {
  time: number;
  frame: XRFrame;
  hitTest: HitTestResult;
  viewerPose: XRViewerPose | null;
  depthData: DepthData | null;  // NEW
}
```

3. In the `render` function, extract depth data and include in callback:
```typescript
const render = (time: number, frame?: XRFrame) => {
  if (!isRunning || !frame) return;

  const hitTest = processHitTest(frame, context.hitTestSource, context.localFloorSpace);
  const viewerPose = frame.getViewerPose(context.localFloorSpace) || null;

  // Extract depth data if available
  const depthData = context.hasDepthSensing
    ? getDepthData(frame, context.localFloorSpace)
    : null;

  onFrame({ time, frame, hitTest, viewerPose, depthData });
  context.renderer.render(scene, camera);
};
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build. `depthData` flows through to frame callbacks.

**Step 3: Commit**

```bash
git add lib/webxr/render-loop.ts
git commit -m "feat: pass depth data through render loop frame callback"
```

---

## Task 4: Create Depth-Based Box Fitting Module

**Files:**
- Create: `lib/measurement/depth-box-fitting.ts`

**Step 1: Create the box fitting algorithm**

Create `lib/measurement/depth-box-fitting.ts`:

```typescript
/**
 * Depth-based object boundary detection and bounding box fitting.
 *
 * Given a depth buffer and a tap point, flood-fills to find the object's
 * silhouette, then unprojects boundary points to 3D to fit a
 * gravity-aligned bounding box.
 */

import * as THREE from 'three';
import { DepthData, getDepthAtNormalized, getDepthBuffer } from '@/lib/webxr/depth-sensing';

export interface DepthBoxResult {
  /** Box center in world space (on floor, raised by half height) */
  center: THREE.Vector3;
  /** Width in meters (X extent in world space) */
  width_m: number;
  /** Depth in meters (Z extent in world space) */
  depth_m: number;
  /** Height in meters (Y extent in world space) */
  height_m: number;
  /** Number of depth pixels in the object region */
  pixelCount: number;
  /** Confidence based on pixel coverage and depth quality */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Detect object boundaries from depth buffer and fit a bounding box.
 *
 * Algorithm:
 * 1. Read center depth at tap point
 * 2. Flood-fill in depth buffer to find connected region at similar depth
 * 3. Extract 2D bounding rect in normalized view coords
 * 4. Sample depth at boundary points and unproject to 3D
 * 5. Fit gravity-aligned box from 3D extent
 *
 * @param depthData - Depth buffer from current frame
 * @param tapNormX - Normalized tap X (0-1, left to right)
 * @param tapNormY - Normalized tap Y (0-1, top to bottom)
 * @param viewerPose - Camera pose for unprojection
 * @param projectionMatrix - XR projection matrix for the view
 * @param floorY - Y coordinate of the floor (from hit-test)
 * @returns DepthBoxResult or null if detection fails
 */
export function fitBoxFromDepth(
  depthData: DepthData,
  tapNormX: number,
  tapNormY: number,
  viewerPose: XRViewerPose,
  floorY: number
): DepthBoxResult | null {
  const { width, height } = depthData;

  // 1. Read center depth
  const centerDepth = getDepthAtNormalized(depthData, tapNormX, tapNormY);
  if (centerDepth <= 0 || centerDepth > 10) {
    console.warn('No valid depth at tap point:', centerDepth);
    return null;
  }

  console.log(`Depth at tap: ${centerDepth.toFixed(3)}m, buffer: ${width}x${height}`);

  // 2. Get full depth buffer for flood-fill
  const buffer = getDepthBuffer(depthData);
  if (!buffer) {
    console.warn('Failed to read depth buffer');
    return null;
  }

  // 3. Flood-fill from tap point
  const depthTolerance = Math.max(centerDepth * 0.15, 0.10); // 15% of distance or 10cm
  const tapBufX = Math.round(tapNormX * (width - 1));
  const tapBufY = Math.round(tapNormY * (height - 1));

  const region = floodFillDepth(
    buffer, width, height,
    tapBufX, tapBufY,
    centerDepth, depthTolerance
  );

  if (region.count < 4) {
    console.warn('Too few depth pixels in object region:', region.count);
    return null;
  }

  console.log(`Flood-fill: ${region.count} pixels, bounds: [${region.minX},${region.minY}]-[${region.maxX},${region.maxY}]`);

  // 4. Unproject boundary points to 3D world space
  const view = viewerPose.views[0];
  const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
  const projMatrixInv = projMatrix.clone().invert();
  const viewMatrix = new THREE.Matrix4().fromArray(
    view.transform.inverse.matrix
  );
  const viewMatrixInv = new THREE.Matrix4().fromArray(
    view.transform.matrix
  );

  // Sample depth at grid points within the region to build 3D point cloud
  const worldPoints: THREE.Vector3[] = [];
  const stepX = Math.max(1, Math.floor((region.maxX - region.minX) / 20));
  const stepY = Math.max(1, Math.floor((region.maxY - region.minY) / 20));

  for (let by = region.minY; by <= region.maxY; by += stepY) {
    for (let bx = region.minX; bx <= region.maxX; bx += stepX) {
      const idx = by * width + bx;
      if (!region.mask[idx]) continue;

      const d = buffer[idx];
      if (d <= 0) continue;

      // Convert buffer coords to normalized view coords
      const nx = (bx + 0.5) / width;
      const ny = (by + 0.5) / height;

      // Unproject to world
      const worldPt = unprojectDepthToWorld(
        nx, ny, d, projMatrixInv, viewMatrixInv
      );
      if (worldPt) {
        worldPoints.push(worldPt);
      }
    }
  }

  if (worldPoints.length < 3) {
    console.warn('Too few 3D points after unprojection:', worldPoints.length);
    return null;
  }

  console.log(`Unprojected ${worldPoints.length} 3D points`);

  // 5. Fit gravity-aligned bounding box
  return fitGravityAlignedBox(worldPoints, floorY);
}

/**
 * Flood-fill in the depth buffer starting from (startX, startY).
 * Finds connected pixels whose depth is within tolerance of centerDepth.
 */
function floodFillDepth(
  buffer: Float32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  centerDepth: number,
  tolerance: number
): { mask: Uint8Array; count: number; minX: number; maxX: number; minY: number; maxY: number } {
  const mask = new Uint8Array(width * height);
  let count = 0;
  let minX = startX, maxX = startX, minY = startY, maxY = startY;

  const queue: [number, number][] = [[startX, startY]];
  const startIdx = startY * width + startX;
  if (buffer[startIdx] <= 0) {
    return { mask, count: 0, minX, maxX, minY, maxY };
  }
  mask[startIdx] = 1;

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    count++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    // 4-connected neighbors
    const neighbors: [number, number][] = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (mask[nIdx]) continue;

      const d = buffer[nIdx];
      if (d <= 0) continue; // No depth data
      if (Math.abs(d - centerDepth) <= tolerance) {
        mask[nIdx] = 1;
        queue.push([nx, ny]);
      }
    }
  }

  return { mask, count, minX, maxX, minY, maxY };
}

/**
 * Unproject a normalized view coordinate + depth to world space.
 *
 * Normalized view coords: x in [0,1] left→right, y in [0,1] top→bottom.
 * Depth is distance from camera plane in meters.
 */
function unprojectDepthToWorld(
  normX: number,
  normY: number,
  depthMeters: number,
  projMatrixInv: THREE.Matrix4,
  viewMatrixInv: THREE.Matrix4
): THREE.Vector3 | null {
  // Convert normalized view coords to NDC
  // NDC: x [-1, 1] left→right, y [-1, 1] bottom→top, z [-1, 1] near→far
  const ndcX = normX * 2 - 1;
  const ndcY = 1 - normY * 2; // Flip Y (view top→bottom vs NDC bottom→top)

  // Unproject a point on the near plane to get ray direction in camera space
  const nearPoint = new THREE.Vector4(ndcX, ndcY, -1, 1);
  nearPoint.applyMatrix4(projMatrixInv);
  nearPoint.divideScalar(nearPoint.w);

  // Ray direction in camera space (from origin through unprojected point)
  const rayDir = new THREE.Vector3(nearPoint.x, nearPoint.y, nearPoint.z).normalize();

  // The depth is distance along the camera's forward axis (Z).
  // Scale ray to reach the correct depth along the viewing direction.
  // Camera forward is -Z in WebXR, so depth corresponds to -z distance.
  // depthMeters = distance along viewing direction, so:
  // point_cam = rayDir * (depthMeters / -rayDir.z)
  if (Math.abs(rayDir.z) < 1e-6) return null;
  const t = depthMeters / Math.abs(rayDir.z);
  const pointCam = rayDir.multiplyScalar(t);

  // Transform to world space
  const pointWorld = new THREE.Vector4(pointCam.x, pointCam.y, pointCam.z, 1);
  pointWorld.applyMatrix4(viewMatrixInv);

  return new THREE.Vector3(pointWorld.x, pointWorld.y, pointWorld.z);
}

/**
 * Fit a gravity-aligned (Y-up) bounding box to a set of 3D world points.
 * Uses the floor Y as the box bottom.
 */
function fitGravityAlignedBox(
  points: THREE.Vector3[],
  floorY: number
): DepthBoxResult {
  // Find extents in world space
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  // Use floor Y as bottom, point cloud top as top
  // This gives us accurate height even if floor points are sparse
  const bottomY = floorY;
  const topY = maxY;

  // Clamp dimensions to reasonable range
  const width_m = Math.max(0.05, Math.min(maxX - minX, 5.0));
  const depth_m = Math.max(0.05, Math.min(maxZ - minZ, 5.0));
  const height_m = Math.max(0.05, Math.min(topY - bottomY, 5.0));

  // Center of the box
  const center = new THREE.Vector3(
    (minX + maxX) / 2,
    bottomY + height_m / 2,
    (minZ + maxZ) / 2
  );

  // Confidence based on point count and dimension sanity
  const pixelCount = points.length;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (pixelCount > 50 && width_m > 0.05 && depth_m > 0.05 && height_m > 0.05) {
    confidence = 'HIGH';
  } else if (pixelCount > 20) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  console.log(
    `Box fit: ${width_m.toFixed(3)} x ${depth_m.toFixed(3)} x ${height_m.toFixed(3)} m, ` +
    `center=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}), ` +
    `${pixelCount} pts, confidence=${confidence}`
  );

  return { center, width_m, depth_m, height_m, pixelCount, confidence };
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build. Module ready for use in ARSession.

**Step 3: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts
git commit -m "feat: add depth-based object boundary detection and box fitting"
```

---

## Task 5: Wire Depth Tap into ARSession

**Files:**
- Modify: `components/ARSession.tsx`

**Step 1: Store depth data from render loop and use on tap**

1. Add imports at top of file:
```typescript
import { DepthData } from '@/lib/webxr/depth-sensing';
import { fitBoxFromDepth, DepthBoxResult } from '@/lib/measurement/depth-box-fitting';
```

2. Add a ref to store current depth data (near other refs, ~line 73):
```typescript
const currentDepthRef = useRef<DepthData | null>(null);
```

3. In `handleFrame` callback (~line 223), store depth data:
```typescript
// Store depth data for tap-time use
currentDepthRef.current = data.depthData;
```

4. Modify the tap handler in `handleTouchEnd` (~line 697, the `READY_TO_DRAW` branch). Replace the simple `PLACE_BOX` dispatch with depth-enhanced placement:

```typescript
// In READY_TO_DRAW state, tap places a box
if (context.state === 'READY_TO_DRAW') {
  const stability = currentHitRef.current?.stability || 0.5;
  const floorY = touchStart.position.y;

  // Try depth-enhanced placement first
  if (currentDepthRef.current && currentFrameRef.current) {
    const frame = currentFrameRef.current;
    const viewerPose = frame.getViewerPose(xrContextRef.current!.localFloorSpace);

    if (viewerPose) {
      // Convert tap screen position to normalized view coords
      // touchStart.position is in world space from hit-test,
      // but we need screen coords. Use the touch event's last known position.
      const lastTouch = e.changedTouches[0];
      if (lastTouch) {
        const normX = lastTouch.clientX / window.innerWidth;
        const normY = lastTouch.clientY / window.innerHeight;

        const boxResult = fitBoxFromDepth(
          currentDepthRef.current,
          normX,
          normY,
          viewerPose,
          floorY
        );

        if (boxResult) {
          console.log('Depth box result:', boxResult);

          // Create anchor point at box center on floor
          const anchorPoint: MeasurementPoint = {
            position: new THREE.Vector3(
              boxResult.center.x - boxResult.width_m / 2,
              floorY,
              boxResult.center.z - boxResult.depth_m / 2
            ),
            timestamp: Date.now(),
            stability,
          };
          const endPoint: MeasurementPoint = {
            position: new THREE.Vector3(
              boxResult.center.x + boxResult.width_m / 2,
              floorY,
              boxResult.center.z + boxResult.depth_m / 2
            ),
            timestamp: Date.now(),
            stability,
          };

          // Dispatch with depth-derived dimensions
          setContext((prev) => ({
            ...prev,
            dragStart: anchorPoint,
            dragEnd: endPoint,
            width_m: boxResult.width_m,
            depth_m: boxResult.depth_m,
            height_m: boxResult.height_m,
            rotation_deg: 0,
            llmEstimate: {
              width_cm: Math.round(boxResult.width_m * 100),
              depth_cm: Math.round(boxResult.depth_m * 100),
              height_cm: Math.round(boxResult.height_m * 100),
              confidence: boxResult.confidence,
              objectDescription: 'Depth-sensed measurement',
            },
            state: 'HEIGHT_INPUT' as const,
          }));
          return;
        }
      }
    }
  }

  // Fallback: place default box (no depth available)
  const point: MeasurementPoint = {
    position: touchStart.position.clone(),
    timestamp: Date.now(),
    stability,
  };
  dispatch({ type: 'PLACE_BOX', point });
  return;
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean build. Depth tap is wired up with fallback.

**Step 3: Test on device**

1. Run `npm run dev:https`
2. Open `https://YOUR_IP:3000` on Android Chrome
3. Start AR session
4. Point at an object on a flat surface
5. Tap — observe console logs:
   - If depth available: "Depth at tap: X.XXXm" → "Flood-fill: N pixels" → "Box fit: ..."
   - If depth unavailable: Falls back to default 40cm box
6. Verify the box appears sized to the object

**Step 4: Commit**

```bash
git add components/ARSession.tsx
git commit -m "feat: use depth sensing to auto-size bounding box on tap"
```

---

## Task 6: Add Depth Availability Indicator to UI

**Files:**
- Modify: `components/ARSession.tsx`
- Modify: `components/MeasurementUI.tsx`

**Step 1: Track depth availability in state**

In `ARSession.tsx`, add state for depth availability:
```typescript
const [hasDepth, setHasDepth] = useState(false);
```

In `handleFrame`, update it when depth data first arrives:
```typescript
if (data.depthData && !hasDepth) {
  setHasDepth(true);
}
```

Pass `hasDepth` to `MeasurementUI`:
```typescript
<MeasurementUI
  // ... existing props
  hasDepth={hasDepth}
/>
```

**Step 2: Show indicator in MeasurementUI**

In `MeasurementUI.tsx`, accept the new prop and show a small badge when in READY_TO_DRAW state:
```typescript
// In the props interface
hasDepth?: boolean;

// In the READY_TO_DRAW instruction area, add a small indicator
{hasDepth && (
  <div className="text-xs text-green-400 mt-1">
    Depth sensing active
  </div>
)}
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build. UI shows depth status.

**Step 4: Commit**

```bash
git add components/ARSession.tsx components/MeasurementUI.tsx
git commit -m "feat: show depth sensing availability indicator in AR UI"
```

---

## Task 7: Handle Edge Cases and Polish

**Files:**
- Modify: `lib/measurement/depth-box-fitting.ts`
- Modify: `components/ARSession.tsx`

**Step 1: Add flood-fill size limit**

In `floodFillDepth`, add a maximum pixel count to prevent runaway fills (e.g., tapping on a wall fills the entire buffer):

```typescript
// At the top of the while loop:
const MAX_FILL_PIXELS = Math.floor(width * height * 0.7); // Max 70% of buffer

while (queue.length > 0) {
  if (count >= MAX_FILL_PIXELS) {
    console.warn('Flood-fill hit max pixel limit');
    break;
  }
  // ... rest of loop
}
```

**Step 2: Add minimum object size filter**

In `fitBoxFromDepth`, after getting the box result, reject objects that are unreasonably small or large:

```typescript
// After fitGravityAlignedBox returns:
if (result.width_m < 0.03 || result.depth_m < 0.03 || result.height_m < 0.03) {
  console.warn('Object too small, likely noise');
  return null;
}
if (result.width_m > 4.0 || result.depth_m > 4.0 || result.height_m > 4.0) {
  console.warn('Object too large, likely background');
  return null;
}
```

**Step 3: Use performance optimization for flood-fill**

Replace the shift-based BFS queue with an index-based approach for better performance:

```typescript
// Replace queue.shift() pattern with index-based:
let queueHead = 0;
while (queueHead < queue.length) {
  if (count >= MAX_FILL_PIXELS) break;
  const [x, y] = queue[queueHead++];
  // ... rest of loop
}
```

**Step 4: Build and test on device**

Run: `npm run build`, then test on device:
- Tap on a small object → should get a small box
- Tap on a large object → should get a large box
- Tap on the floor/wall → should fall back to default (flood-fill hits limit)

**Step 5: Commit**

```bash
git add lib/measurement/depth-box-fitting.ts components/ARSession.tsx
git commit -m "fix: add flood-fill limits and size guards for depth box fitting"
```

---

## Verification Checklist

After all tasks are complete, test these scenarios on an Android phone with Chrome:

1. **Depth available**: Tap on a box/bin/chair on the floor → box should auto-size close to actual dimensions
2. **No depth**: If depth-sensing is denied or unavailable → falls back to 40cm default box
3. **After placement**: Move/rotate/resize handles still work normally
4. **Small objects**: Tap on a cup or small item → box should be small
5. **Large objects**: Tap on a couch or table → box should be large
6. **Wall/floor**: Tapping on the floor or wall → should not create a huge box (flood-fill limit)
7. **UI indicator**: "Depth sensing active" shows in READY_TO_DRAW state when depth is available
8. **Find Storage**: After depth-measured box → find storage flow still works with correct dimensions
