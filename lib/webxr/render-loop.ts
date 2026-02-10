import * as THREE from 'three';
import { XRSessionContext } from './session-manager';
import { processHitTest, HitTestResult } from './hit-test';
import { XRCPUDepthInformation } from '@/lib/types';

export interface FrameData {
  time: number;
  frame: XRFrame;
  hitTest: HitTestResult;
  viewerPose: XRViewerPose | null;
  depthInfo: XRCPUDepthInformation | null;
  view: XRView | null;
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

    // Get depth information if available
    let depthInfo: XRCPUDepthInformation | null = null;
    let view: XRView | null = null;
    if (viewerPose && viewerPose.views.length > 0 && context.hasDepthSensing) {
      view = viewerPose.views[0];
      try {
        depthInfo = (frame as any).getDepthInformation(view) || null;
      } catch {
        // Depth info not available this frame
      }
    }

    // Call frame callback with data
    onFrame({
      time,
      frame,
      hitTest,
      viewerPose,
      depthInfo,
      view,
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
