import * as THREE from 'three';

// WebXR Types (extending native types)
export interface XRHitTestSource {
  cancel(): void;
}

export interface XRHitTestResult {
  getPose(baseSpace: XRReferenceSpace): XRPose | null;
}

// Application State Machine (floor taps + height slider)
// WebXR hit-test only detects surfaces, so we capture 2 floor points
// and let user input height manually via slider
export type MeasurementState =
  | 'IDLE'
  | 'CHECKING_SUPPORT'
  | 'UNSUPPORTED'
  | 'SUPPORTED_READY'
  | 'AR_STARTING'
  | 'AR_RUNNING'
  | 'FLOOR_1'       // Tap first floor corner of object base
  | 'FLOOR_2'       // Tap diagonal opposite floor corner
  | 'HEIGHT_INPUT'  // User adjusts height via slider
  | 'REVIEW'
  | 'SEARCHING'
  | 'RESULTS';

// Capability Detection
export interface CapabilityChecks {
  secureContext: boolean;
  xrAvailable: boolean;
  immersiveARSupported: boolean;
  requiredFeaturesSupported: boolean;
}

export interface CapabilityResult {
  supported: boolean;
  checks: CapabilityChecks;
  errorMessage?: string;
}

// Measurement Points
export interface MeasurementPoint {
  position: THREE.Vector3;
  timestamp: number;
  stability: number; // 0-1 confidence
}

export interface MeasurementData {
  floorPoint1: MeasurementPoint;  // First floor corner
  floorPoint2: MeasurementPoint;  // Diagonal opposite floor corner
  height_m: number;               // User-input height (slider)
  width_m: number;                // Calculated from floor points
  depth_m: number;                // Calculated from floor points
  volume_m3: number;
  confidence: ConfidenceLevel;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

// Stabilization
export interface StabilizationFrame {
  position: THREE.Vector3;
  timestamp: number;
}

export interface StabilizationResult {
  isStable: boolean;
  stability: number; // 0-1
  averagedPosition: THREE.Vector3;
  message?: string;
}

// Computed Measurements (for display)
export interface ComputedMeasurements {
  width_cm: number;
  width_in: number;
  depth_cm: number;
  depth_in: number;
  height_cm: number;
  height_in: number;
  volume_m3: number;
  volume_ft3: number;
}

// Storage Search API
export interface StorageSearchRequest {
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  volume_m3: number;
  radius_km: number;
  user_location: { lat: number; lng: number } | null;
  timestamp: string;
}

export interface StorageUnit {
  id: string;
  name: string;
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  volume_m3: number;
  price_monthly: number;
  available: boolean;
}

export interface StorageFacility {
  id: string;
  name: string;
  address: string;
  distance_km: number | null;
  units: StorageUnit[];
  rating: number;
}

export interface StorageSearchResponse {
  facilities: StorageFacility[];
  object_dimensions: {
    width_cm: number;
    depth_cm: number;
    height_cm: number;
    volume_m3: number;
  };
}

// UI State
export interface UIState {
  currentStep: string;
  instruction: string;
  canUndo: boolean;
  canReset: boolean;
  showMeasurements: boolean;
  trackingWarning: string | null;
}

// Geometry helpers
export interface Rectangle3D {
  center: THREE.Vector3;
  width: number;
  depth: number;
  widthDirection: THREE.Vector3;
  depthDirection: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface BasePlane {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}
