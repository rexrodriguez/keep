import * as THREE from 'three';
import {
  MeasurementPoint,
  MeasurementData,
  ComputedMeasurements,
  ConfidenceLevel,
} from '@/lib/types';
import {
  fitRectangleToPoints,
  calculateBasePlane,
  calculateHeightFromPlane,
  calculateOrthogonalityError,
} from './geometry';
import { calculatePointSetStability } from './stabilization';

// Conversion constants
const METERS_TO_CM = 100;
const METERS_TO_INCHES = 39.3701;
const CUBIC_METERS_TO_CUBIC_FEET = 35.3147;

/**
 * Calculate full measurement data from points
 */
export function calculateMeasurements(
  basePoints: MeasurementPoint[],
  heightPoint: MeasurementPoint | null
): MeasurementData | null {
  if (basePoints.length < 4 || !heightPoint) {
    return null;
  }

  const positions = basePoints.map((p) => p.position);

  // Fit rectangle to base points
  const rectangle = fitRectangleToPoints(positions);

  // Calculate base plane
  const basePlane = calculateBasePlane(positions);

  // Calculate height
  const height_m = calculateHeightFromPlane(basePlane, heightPoint.position);

  // Calculate volume
  const volume_m3 = rectangle.width * rectangle.depth * height_m;

  // Calculate confidence
  const confidence = calculateConfidence(
    basePoints,
    heightPoint,
    rectangle.width,
    rectangle.depth
  );

  return {
    basePoints,
    heightPoint,
    width_m: rectangle.width,
    depth_m: rectangle.depth,
    height_m,
    volume_m3,
    confidence,
  };
}

/**
 * Calculate partial measurements (when not all points are captured)
 */
export function calculatePartialMeasurements(
  basePoints: MeasurementPoint[]
): Partial<ComputedMeasurements> {
  if (basePoints.length < 2) {
    return {};
  }

  const positions = basePoints.map((p) => p.position);

  if (basePoints.length === 2) {
    // Just width (first edge)
    const width_m = positions[0].distanceTo(positions[1]);
    return {
      width_cm: width_m * METERS_TO_CM,
      width_in: width_m * METERS_TO_INCHES,
    };
  }

  if (basePoints.length === 3) {
    // Width and partial depth estimate
    const width_m = positions[0].distanceTo(positions[1]);
    const depth_m = positions[1].distanceTo(positions[2]);
    return {
      width_cm: width_m * METERS_TO_CM,
      width_in: width_m * METERS_TO_INCHES,
      depth_cm: depth_m * METERS_TO_CM,
      depth_in: depth_m * METERS_TO_INCHES,
    };
  }

  // 4 points - full base measurements
  const rectangle = fitRectangleToPoints(positions);
  return {
    width_cm: rectangle.width * METERS_TO_CM,
    width_in: rectangle.width * METERS_TO_INCHES,
    depth_cm: rectangle.depth * METERS_TO_CM,
    depth_in: rectangle.depth * METERS_TO_INCHES,
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
 * Calculate confidence level based on multiple factors
 */
function calculateConfidence(
  basePoints: MeasurementPoint[],
  heightPoint: MeasurementPoint,
  width: number,
  depth: number
): ConfidenceLevel {
  const positions = basePoints.map((p) => p.position);

  // Factor 1: Tracking stability at capture time
  const stabilities = [...basePoints.map((p) => p.stability), heightPoint.stability];
  const avgStability = calculatePointSetStability(positions, stabilities);

  // Factor 2: Orthogonality of base rectangle
  const orthoError = calculateOrthogonalityError(positions);

  // Factor 3: Aspect ratio sanity check (not too extreme)
  const aspectRatio = Math.max(width, depth) / Math.min(width, depth);
  const aspectOk = aspectRatio < 10; // Reasonable aspect ratio

  // Determine confidence level
  if (avgStability > 0.8 && orthoError < 5 && aspectOk) {
    return 'HIGH';
  }

  if (avgStability > 0.5 && orthoError < 15 && aspectOk) {
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
