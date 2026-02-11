import * as THREE from 'three';
import { XRSessionContext } from './session-manager';
import { processHitTest, HitTestResult } from './hit-test';

export interface FrameData {
  time: number;
  frame: XRFrame;
  hitTest: HitTestResult;
  viewerPose: XRViewerPose | null;
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

  const render = (time: number, frame?: XRFrame) => {
    if (!isRunning || !frame) return;

    try {
      // Get hit-test results
      const hitTest = processHitTest(
        frame,
        context.hitTestSource,
        context.localFloorSpace
      );

      // Get viewer pose and primary view (cheap references, no depth readback)
      const viewerPose = frame.getViewerPose(context.localFloorSpace) || null;
      const view = (viewerPose && viewerPose.views.length > 0) ? viewerPose.views[0] : null;

      // Call frame callback with data
      onFrame({
        time,
        frame,
        hitTest,
        viewerPose,
        view,
      });

      // Render scene
      context.renderer.render(scene, camera);
    } catch (error) {
      console.warn('Render loop error:', error);
      // Don't rethrow - let setAnimationLoop continue calling us next frame
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

  return { start, stop };
}
