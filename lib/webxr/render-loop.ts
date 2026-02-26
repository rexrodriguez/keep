import * as THREE from 'three';
import { XRSessionContext } from './session-manager';
import { processHitTest, HitTestResult } from './hit-test';
import { DepthData, getDepthData } from './depth-sensing';

export interface FrameData {
  time: number;
  frame: XRFrame;
  hitTest: HitTestResult;
  viewerPose: XRViewerPose | null;
  depthData: DepthData | null;
}

export type FrameCallback = (data: FrameData) => void;

/**
 * Create and manage the XR render loop
 */
export function createRenderLoop(
  context: XRSessionContext,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  onFrame: FrameCallback
): { start: () => void; stop: () => void; captureNextFrame: (cb: (dataUrl: string) => void) => void } {
  let isRunning = false;
  let captureCallback: ((dataUrl: string) => void) | null = null;

  const render = (time: number, frame?: XRFrame) => {
    if (!isRunning || !frame) return;

    // Get hit-test results
    const hitTest = processHitTest(
      frame,
      context.hitTestSource,
      context.localFloorSpace
    );

    // Get viewer pose
    const viewerPose = frame.getViewerPose(context.localFloorSpace) || null;

    // Get depth data if depth sensing is available
    const depthData = context.hasDepthSensing
      ? getDepthData(frame, context.localFloorSpace)
      : null;

    // Call frame callback with data
    onFrame({
      time,
      frame,
      hitTest,
      viewerPose,
      depthData,
    });

    // Render scene
    context.renderer.render(scene, camera);

    // Capture frame if requested (must happen right after render while
    // the XR opaque framebuffer is still bound — toDataURL doesn't work
    // in WebXR because the canvas isn't the render target)
    if (captureCallback) {
      const cb = captureCallback;
      captureCallback = null;
      try {
        const gl = context.renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;

        // Read pixels from the XR framebuffer
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Scale down to thumbnail via offscreen canvas
        const thumbW = 320;
        const thumbH = Math.round(thumbW * (h / w));
        const fullCanvas = new OffscreenCanvas(w, h);
        const fullCtx = fullCanvas.getContext('2d')!;
        const imgData = new ImageData(new Uint8ClampedArray(pixels.buffer), w, h);
        fullCtx.putImageData(imgData, 0, 0);

        // Flip vertically (WebGL reads bottom-up) and scale down
        const thumb = new OffscreenCanvas(thumbW, thumbH);
        const tctx = thumb.getContext('2d')!;
        tctx.translate(0, thumbH);
        tctx.scale(1, -1);
        tctx.drawImage(fullCanvas, 0, 0, thumbW, thumbH);

        thumb.convertToBlob({ type: 'image/jpeg', quality: 0.5 }).then(blob => {
          const reader = new FileReader();
          reader.onload = () => cb(reader.result as string);
          reader.readAsDataURL(blob);
        }).catch(() => cb(''));
      } catch {
        cb('');
      }
    }
  };

  const start = () => {
    if (isRunning) return;
    isRunning = true;
    context.renderer.setAnimationLoop(render);
  };

  const stop = () => {
    isRunning = false;
    context.renderer.setAnimationLoop(null);
  };

  const captureNextFrame = (cb: (dataUrl: string) => void) => {
    captureCallback = cb;
  };

  return { start, stop, captureNextFrame };
}
