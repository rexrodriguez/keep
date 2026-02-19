import * as THREE from 'three';
import { poseToTransform } from './session-manager';

export interface HitTestResult {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
  rawMatrix: Float32Array;  // raw pose.transform.matrix (col-major, 16 floats)
  hasHit: boolean;
}

/**
 * Process hit-test results from XR frame
 */
export function processHitTest(
  frame: XRFrame,
  hitTestSource: XRHitTestSource | null,
  referenceSpace: XRReferenceSpace
): HitTestResult {
  const defaultResult: HitTestResult = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    matrix: new THREE.Matrix4(),
    rawMatrix: new Float32Array(16),
    hasHit: false,
  };

  if (!hitTestSource) {
    return defaultResult;
  }

  try {
    const results = frame.getHitTestResults(hitTestSource);

    if (results.length > 0) {
      const pose = results[0].getPose(referenceSpace);

      if (pose) {
        const transform = poseToTransform(pose);
        return {
          ...transform,
          rawMatrix: pose.transform.matrix as unknown as Float32Array,
          hasHit: true,
        };
      }
    }
  } catch (error) {
    console.warn('Hit-test error:', error);
  }

  return defaultResult;
}

/**
 * Check if a surface is suitable for measurement (roughly horizontal)
 */
export function isSurfaceHorizontal(
  quaternion: THREE.Quaternion,
  toleranceDegrees: number = 30
): boolean {
  // Get the up vector after rotation
  const up = new THREE.Vector3(0, 1, 0);
  const normal = up.clone().applyQuaternion(quaternion);

  // Check angle from vertical
  const angle = Math.acos(Math.abs(normal.y)) * (180 / Math.PI);

  return angle < toleranceDegrees;
}

/**
 * Get the surface normal from hit-test pose
 */
export function getSurfaceNormal(quaternion: THREE.Quaternion): THREE.Vector3 {
  const up = new THREE.Vector3(0, 1, 0);
  return up.applyQuaternion(quaternion).normalize();
}
