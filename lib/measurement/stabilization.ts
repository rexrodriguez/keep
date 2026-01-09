import * as THREE from 'three';
import { StabilizationFrame, StabilizationResult } from '@/lib/types';

const WINDOW_SIZE = 10;
const POSITION_VARIANCE_THRESHOLD = 0.005; // 5mm
const MIN_FRAMES_FOR_STABILITY = 5;

/**
 * Rolling window for pose stabilization
 */
export class PoseStabilizer {
  private frames: StabilizationFrame[] = [];
  private windowSize: number;
  private varianceThreshold: number;

  constructor(
    windowSize: number = WINDOW_SIZE,
    varianceThreshold: number = POSITION_VARIANCE_THRESHOLD
  ) {
    this.windowSize = windowSize;
    this.varianceThreshold = varianceThreshold;
  }

  /**
   * Add a new frame to the rolling window
   */
  addFrame(position: THREE.Vector3): void {
    this.frames.push({
      position: position.clone(),
      timestamp: performance.now(),
    });

    // Keep only last N frames
    if (this.frames.length > this.windowSize) {
      this.frames.shift();
    }
  }

  /**
   * Check if current pose is stable enough for capture
   */
  checkStability(): StabilizationResult {
    if (this.frames.length < MIN_FRAMES_FOR_STABILITY) {
      return {
        isStable: false,
        stability: 0,
        averagedPosition: new THREE.Vector3(),
        message: 'Gathering tracking data...',
      };
    }

    // Calculate average position
    const avg = new THREE.Vector3();
    this.frames.forEach((f) => avg.add(f.position));
    avg.divideScalar(this.frames.length);

    // Calculate variance (max distance from average)
    let maxVariance = 0;
    this.frames.forEach((f) => {
      const dist = f.position.distanceTo(avg);
      maxVariance = Math.max(maxVariance, dist);
    });

    // Calculate stability score (0-1)
    const stability = Math.max(
      0,
      1 - maxVariance / (this.varianceThreshold * 2)
    );

    const isStable = maxVariance < this.varianceThreshold;

    return {
      isStable,
      stability,
      averagedPosition: avg,
      message: isStable
        ? undefined
        : 'Move phone slowly to improve tracking',
    };
  }

  /**
   * Get the averaged position for capture
   */
  getAveragedPosition(): THREE.Vector3 {
    if (this.frames.length === 0) {
      return new THREE.Vector3();
    }

    const avg = new THREE.Vector3();
    this.frames.forEach((f) => avg.add(f.position));
    avg.divideScalar(this.frames.length);
    return avg;
  }

  /**
   * Clear the rolling window
   */
  reset(): void {
    this.frames = [];
  }

  /**
   * Get current frame count
   */
  getFrameCount(): number {
    return this.frames.length;
  }
}

/**
 * Calculate stability score for a set of points
 * Used for confidence indicator
 */
export function calculatePointSetStability(
  points: THREE.Vector3[],
  stabilities: number[]
): number {
  if (stabilities.length === 0) return 0;

  const avgStability =
    stabilities.reduce((sum, s) => sum + s, 0) / stabilities.length;
  return avgStability;
}

/**
 * Check if tracking quality is sufficient
 */
export function isTrackingQualitySufficient(
  stability: number,
  minStability: number = 0.5
): boolean {
  return stability >= minStability;
}
