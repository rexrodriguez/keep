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
 * Read the raw depth buffer as a Float32Array for bulk operations.
 * Each value is depth in meters. 0 means no data.
 * Returns null if unable to read the buffer.
 */
export function getDepthBuffer(depthData: DepthData): Float32Array | null {
  try {
    const { depthInfo } = depthData;
    const { width, height, rawValueToMeters } = depthInfo;
    const buffer = new Float32Array(width * height);

    const rawData = depthInfo.data as ArrayBuffer;
    const dataFormat = depthInfo.dataFormat || 'luminance-alpha';

    if (dataFormat === 'float32' || rawData.byteLength === width * height * 4) {
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
