import * as THREE from 'three';
import {
  MeasurementPoint,
  MeasurementData,
  ComputedMeasurements,
  ConfidenceLevel,
} from '@/lib/types';

// Conversion constants
const METERS_TO_CM = 100;
const METERS_TO_INCHES = 39.3701;
const CUBIC_METERS_TO_CUBIC_FEET = 35.3147;

/**
 * Calculate measurements from two diagonal corners.
 * Corner 1: Bottom corner (any bottom corner of bounding box)
 * Corner 2: Opposite top corner (diagonal from corner 1)
 *
 * This gives us the bounding box dimensions directly.
 */
export function calculateMeasurementsFromCorners(
  corner1: MeasurementPoint,
  corner2: MeasurementPoint
): MeasurementData {
  const p1 = corner1.position;
  const p2 = corner2.position;

  // Calculate dimensions from the two diagonal corners
  // Width and depth are horizontal distances, height is vertical
  const width_m = Math.abs(p2.x - p1.x);
  const depth_m = Math.abs(p2.z - p1.z);
  const height_m = Math.abs(p2.y - p1.y);

  // Calculate volume
  const volume_m3 = width_m * depth_m * height_m;

  // Calculate confidence based on stability
  const confidence = calculateConfidence(corner1, corner2, width_m, depth_m, height_m);

  return {
    corner1,
    corner2,
    width_m,
    depth_m,
    height_m,
    volume_m3,
    confidence,
  };
}

/**
 * Convert measurement data to display format
 */
export function toComputedMeasurements(
  data: MeasurementData
): ComputedMeasurements {
  return {
    width_cm: round(data.width_m * METERS_TO_CM, 1),
    width_in: round(data.width_m * METERS_TO_INCHES, 1),
    depth_cm: round(data.depth_m * METERS_TO_CM, 1),
    depth_in: round(data.depth_m * METERS_TO_INCHES, 1),
    height_cm: round(data.height_m * METERS_TO_CM, 1),
    height_in: round(data.height_m * METERS_TO_INCHES, 1),
    volume_m3: round(data.volume_m3, 3),
    volume_ft3: round(data.volume_m3 * CUBIC_METERS_TO_CUBIC_FEET, 2),
  };
}

/**
 * Calculate confidence level based on stability and sanity checks
 */
function calculateConfidence(
  corner1: MeasurementPoint,
  corner2: MeasurementPoint,
  width: number,
  depth: number,
  height: number
): ConfidenceLevel {
  // Factor 1: Tracking stability at capture time
  const avgStability = (corner1.stability + corner2.stability) / 2;

  // Factor 2: Minimum dimension check (not too small to be a mistake)
  const minDimension = Math.min(width, depth, height);
  const maxDimension = Math.max(width, depth, height);
  const dimensionsOk = minDimension > 0.01 && maxDimension < 10; // 1cm to 10m

  // Factor 3: Aspect ratio sanity check
  const aspectRatio = maxDimension / Math.max(minDimension, 0.001);
  const aspectOk = aspectRatio < 50; // Not too extreme

  // Determine confidence level
  if (avgStability > 0.8 && dimensionsOk && aspectOk) {
    return 'HIGH';
  }

  if (avgStability > 0.5 && dimensionsOk) {
    return 'MEDIUM';
  }

  return 'LOW';
}

/**
 * Round to specified decimal places
 */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Format measurement for display
 */
export function formatMeasurement(
  valueCm: number,
  valueIn: number
): string {
  return `${valueCm.toFixed(1)} cm (${valueIn.toFixed(1)}")`;
}

/**
 * Format volume for display
 */
export function formatVolume(m3: number, ft3: number): string {
  return `${m3.toFixed(3)} m³ (${ft3.toFixed(2)} ft³)`;
}
