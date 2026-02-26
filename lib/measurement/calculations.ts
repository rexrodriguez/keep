import * as THREE from 'three';
import {
  MeasurementPoint,
  MeasurementData,
  MeasuredItem,
  ComputedMeasurements,
  ConfidenceLevel,
} from '@/lib/types';

// Conversion constants
const METERS_TO_CM = 100;
const METERS_TO_INCHES = 39.3701;
const CUBIC_METERS_TO_CUBIC_FEET = 35.3147;

/**
 * Calculate measurements from drag rectangle corners and user-input height.
 * DragStart and DragEnd: Diagonal corners of object's floor footprint from drag gesture
 * Height: User-adjusted via slider (since WebXR hit-test can't detect vertical points)
 *
 * Width/Depth are calculated from the drag rectangle X/Z differences.
 */
export function calculateMeasurementsFromDragRect(
  dragStart: MeasurementPoint,
  dragEnd: MeasurementPoint,
  height_m: number
): MeasurementData {
  const p1 = dragStart.position;
  const p2 = dragEnd.position;

  // Calculate width and depth from drag rectangle (X and Z axes)
  const width_m = Math.abs(p2.x - p1.x);
  const depth_m = Math.abs(p2.z - p1.z);

  // Height is user-provided via slider
  const actualHeight = Math.max(height_m, 0.01); // Min 1cm

  // Calculate volume
  const volume_m3 = width_m * depth_m * actualHeight;

  // Calculate confidence based on stability and dimensions
  const confidence = calculateConfidence(dragStart, dragEnd, width_m, depth_m, actualHeight);

  return {
    floorPoint1: dragStart,
    floorPoint2: dragEnd,
    height_m: actualHeight,
    width_m,
    depth_m,
    volume_m3,
    confidence,
  };
}

/**
 * Calculate measurements from LLM-estimated dimensions.
 * Used when the user captures an image and gets AI-estimated dimensions,
 * which they can then adjust via sliders.
 */
export function calculateMeasurementsFromLLM(
  anchorPoint: MeasurementPoint,
  width_m: number,
  depth_m: number,
  height_m: number,
  llmConfidence: ConfidenceLevel
): MeasurementData {
  // Ensure minimum dimensions
  const actualWidth = Math.max(width_m, 0.01);
  const actualDepth = Math.max(depth_m, 0.01);
  const actualHeight = Math.max(height_m, 0.01);

  // Calculate volume
  const volume_m3 = actualWidth * actualDepth * actualHeight;

  // Create synthetic second point for compatibility
  const floorPoint2: MeasurementPoint = {
    position: anchorPoint.position.clone().add(
      new THREE.Vector3(actualWidth, 0, actualDepth)
    ),
    timestamp: Date.now(),
    stability: anchorPoint.stability,
  };

  return {
    floorPoint1: anchorPoint,
    floorPoint2: floorPoint2,
    height_m: actualHeight,
    width_m: actualWidth,
    depth_m: actualDepth,
    volume_m3,
    confidence: llmConfidence,
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
  floorPoint1: MeasurementPoint,
  floorPoint2: MeasurementPoint,
  width: number,
  depth: number,
  height: number
): ConfidenceLevel {
  // Factor 1: Tracking stability at capture time (floor points only)
  const avgStability = (floorPoint1.stability + floorPoint2.stability) / 2;

  // Factor 2: Minimum dimension check (not too small to be a mistake)
  const minDimension = Math.min(width, depth, height);
  const maxDimension = Math.max(width, depth, height);
  const dimensionsOk = minDimension > 0.01 && maxDimension < 10; // 1cm to 10m

  // Factor 3: Aspect ratio sanity check
  const aspectRatio = maxDimension / Math.max(minDimension, 0.001);
  const aspectOk = aspectRatio < 50; // Not too extreme

  // Factor 4: Floor points should be reasonably separated
  const floorDistance = floorPoint1.position.distanceTo(floorPoint2.position);
  const floorOk = floorDistance > 0.05; // At least 5cm apart

  // Determine confidence level
  if (avgStability > 0.8 && dimensionsOk && aspectOk && floorOk) {
    return 'HIGH';
  }

  if (avgStability > 0.5 && dimensionsOk && floorOk) {
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

/**
 * Compute total volume of multiple measured items.
 */
export function totalVolume(items: MeasuredItem[]): number {
  return items.reduce((sum, item) => sum + item.width_m * item.depth_m * item.height_m, 0);
}
