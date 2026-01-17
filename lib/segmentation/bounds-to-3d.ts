/**
 * Convert 2D segmentation bounds to 3D world-space dimensions
 * Uses perspective projection math with hit-test depth information
 */

import type { SegmentBounds } from './segmenter-manager';

export interface Extents3D {
  width_m: number;
  depth_m: number;
}

/**
 * Calculate 3D world-space dimensions from 2D normalized bounds
 *
 * The key insight is that at distance D from the camera with vertical FOV F,
 * the visible world height is: 2 * D * tan(F/2)
 *
 * We use the bounding box proportion of screen space to estimate real-world size.
 *
 * @param bounds - Normalized 2D bounds (0-1)
 * @param hitDepth - Distance from camera to surface in meters
 * @param fovY - Vertical field of view in radians
 * @param aspectRatio - Camera aspect ratio (width/height)
 * @returns Estimated 3D dimensions in meters
 */
export function calculate3DExtents(
  bounds: SegmentBounds,
  hitDepth: number,
  fovY: number,
  aspectRatio: number
): Extents3D {
  // Calculate visible world dimensions at the hit-test depth
  const visibleHeight = 2 * hitDepth * Math.tan(fovY / 2);
  const visibleWidth = visibleHeight * aspectRatio;

  // Calculate object dimensions from normalized bounds
  const boundWidth = bounds.maxX - bounds.minX;
  const boundHeight = bounds.maxY - bounds.minY;

  // Map 2D bounds to 3D space
  // Note: 2D height (Y) maps to 3D depth (Z) when looking at objects on the floor
  const objectWidth = boundWidth * visibleWidth;
  const objectDepth = boundHeight * visibleHeight;

  // Apply reasonable bounds (min 5cm, max 5m)
  const MIN_DIM = 0.05;
  const MAX_DIM = 5.0;

  return {
    width_m: Math.max(MIN_DIM, Math.min(MAX_DIM, objectWidth)),
    depth_m: Math.max(MIN_DIM, Math.min(MAX_DIM, objectDepth)),
  };
}

/**
 * Get camera FOV from Three.js camera or default
 * @param fovDegrees - FOV in degrees (Three.js default is 50)
 * @returns FOV in radians
 */
export function fovDegreesToRadians(fovDegrees: number): number {
  return (fovDegrees * Math.PI) / 180;
}
