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
): { start: () => void; stop: () => void } {
  let isRunning = false;
  let animationFrameId: number | null = null;

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

  return { start, stop };
}
