import * as THREE from 'three';

export interface XRSessionContext {
  session: XRSession;
  localFloorSpace: XRReferenceSpace;
  viewerSpace: XRReferenceSpace;
  hitTestSource: XRHitTestSource | null;
  renderer: THREE.WebGLRenderer;
  glBinding: XRWebGLBinding | null;
  hasCameraAccess: boolean;
  hasDepthSensing: boolean;
}

/**
 * Start a WebXR AR session with required features
 */
export async function startARSession(
  renderer: THREE.WebGLRenderer,
  overlayElement?: HTMLElement
): Promise<XRSessionContext> {
  const xr = navigator.xr!;

  // Configure session options
  // camera-access is optional - allows raw camera image capture for AI estimation
  const optionalFeatures: string[] = ['camera-access', 'depth-sensing'];
  if (overlayElement) {
    optionalFeatures.push('dom-overlay');
  }

  const sessionInit: XRSessionInit = {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures,
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha'],
    },
  } as any;

  if (overlayElement) {
    (sessionInit as any).domOverlay = { root: overlayElement };
  }

  // Request session
  const session = await xr.requestSession('immersive-ar', sessionInit);

  // Configure renderer for XR
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);

  // Get reference spaces
  const localFloorSpace = await session.requestReferenceSpace('local-floor');
  const viewerSpace = await session.requestReferenceSpace('viewer');

  // Create hit-test source from viewer space
  let hitTestSource: XRHitTestSource | null = null;
  try {
    hitTestSource = await session.requestHitTestSource!({ space: viewerSpace }) ?? null;
  } catch (error) {
    console.warn('Failed to create hit-test source:', error);
  }

  // Create WebGL binding for camera access
  let glBinding: XRWebGLBinding | null = null;
  let hasCameraAccess = false;
  try {
    const gl = renderer.getContext();
    glBinding = new XRWebGLBinding(session, gl);
    // Check if camera-access was granted by trying to see if XRView has camera property
    hasCameraAccess = true;
    console.log('WebXR camera access available');
  } catch (error) {
    console.warn('WebXR camera access not available:', error);
  }

  // Check if depth-sensing was granted
  let hasDepthSensing = false;
  try {
    const sessionAny = session as any;
    hasDepthSensing = !!(sessionAny.depthUsage && sessionAny.depthDataFormat);
    if (hasDepthSensing) {
      console.log('WebXR depth sensing available:', sessionAny.depthUsage, sessionAny.depthDataFormat);
    }
  } catch (error) {
    console.warn('WebXR depth sensing not available:', error);
  }

  return {
    session,
    localFloorSpace,
    viewerSpace,
    hitTestSource,
    renderer,
    glBinding,
    hasCameraAccess,
    hasDepthSensing,
  };
}

/**
 * End an AR session and clean up resources
 */
export async function endARSession(context: XRSessionContext): Promise<void> {
  // Cancel hit-test source
  if (context.hitTestSource) {
    context.hitTestSource.cancel();
  }

  // End session
  await context.session.end();

  // Disable XR on renderer
  context.renderer.xr.enabled = false;
}

/**
 * Get hit-test results for current frame
 */
export function getHitTestResults(
  frame: XRFrame,
  hitTestSource: XRHitTestSource | null,
  referenceSpace: XRReferenceSpace
): { pose: XRPose | null; hasHit: boolean } {
  if (!hitTestSource) {
    return { pose: null, hasHit: false };
  }

  const results = frame.getHitTestResults(hitTestSource);

  if (results.length > 0) {
    const pose = results[0].getPose(referenceSpace) ?? null;
    return { pose, hasHit: pose !== null };
  }

  return { pose: null, hasHit: false };
}

/**
 * Extract position and rotation from XR pose
 */
export function poseToTransform(pose: XRPose): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
} {
  const position = new THREE.Vector3(
    pose.transform.position.x,
    pose.transform.position.y,
    pose.transform.position.z
  );

  const quaternion = new THREE.Quaternion(
    pose.transform.orientation.x,
    pose.transform.orientation.y,
    pose.transform.orientation.z,
    pose.transform.orientation.w
  );

  const matrix = new THREE.Matrix4();
  matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));

  return { position, quaternion, matrix };
}
