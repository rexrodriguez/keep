import * as THREE from 'three';

// WebXR Types (extending native types)
export interface XRHitTestSource {
  cancel(): void;
}

export interface XRHitTestResult {
  getPose(baseSpace: XRReferenceSpace): XRPose | null;
}

// Application State Machine (2-tap flow: CORNER_1 -> CORNER_2 -> REVIEW)
export type MeasurementState =
  | 'IDLE'
  | 'CHECKING_SUPPORT'
  | 'UNSUPPORTED'
  | 'SUPPORTED_READY'
  | 'AR_STARTING'
  | 'AR_RUNNING'
  | 'CORNER_1'      // Tap bottom-front corner
  | 'CORNER_2'      // Tap top-back (diagonal) corner
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
  corner1: MeasurementPoint;      // Bottom-front corner
  corner2: MeasurementPoint;      // Top-back (diagonal) corner
  width_m: number;
  depth_m: number;
  height_m: number;
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
