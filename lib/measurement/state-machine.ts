import * as THREE from 'three';
import { MeasurementState, MeasurementPoint, UIState } from '@/lib/types';

export interface StateMachineContext {
  state: MeasurementState;
  dragStart: MeasurementPoint | null;   // Start corner of drag rectangle
  dragEnd: MeasurementPoint | null;     // End corner of drag rectangle
  targetPoint: MeasurementPoint | null; // Target point for LLM estimation (tap marker)
  floorY: number | null;                // Locked floor Y coordinate (meters)
  floorLockPoint: THREE.Vector3 | null; // World position where floor was locked (grid center)
  height_m: number;                      // User-adjusted height (default 0.5m)
  width_m: number;                       // User-adjusted width (for LLM mode)
  depth_m: number;                       // User-adjusted depth (for LLM mode)
  rotation_deg: number;                  // Box rotation in degrees (0-360)
  llmEstimate: LLMEstimate | null;      // LLM dimension estimate
  isEstimating: boolean;                 // LLM estimation in progress
  error: string | null;
}

export interface LLMEstimate {
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  objectDescription: string;
}

export type StateAction =
  | { type: 'START_CHECK' }
  | { type: 'CHECK_PASSED' }
  | { type: 'CHECK_FAILED'; error: string }
  | { type: 'START_AR' }
  | { type: 'AR_STARTED' }
  | { type: 'AR_FAILED'; error: string }
  | { type: 'LOCK_FLOOR'; floorY: number; position: THREE.Vector3 }
  | { type: 'PLACE_BOX'; point: MeasurementPoint }  // Tap to place default box
  | { type: 'PLACE_DEPTH_BOX'; dragStart: MeasurementPoint; dragEnd: MeasurementPoint;
      width_m: number; depth_m: number; height_m: number; rotation_deg: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }
  | { type: 'START_DRAG'; point: MeasurementPoint }
  | { type: 'UPDATE_DRAG'; point: MeasurementPoint }
  | { type: 'END_DRAG'; point: MeasurementPoint }
  | { type: 'SET_HEIGHT'; height_m: number }
  | { type: 'SET_WIDTH'; width_m: number }
  | { type: 'SET_DEPTH'; depth_m: number }
  | { type: 'SET_ROTATION'; rotation_deg: number }
  | { type: 'MOVE_BOX'; deltaX: number; deltaZ: number }
  | { type: 'CONFIRM_HEIGHT' }
  | { type: 'SET_TARGET'; point: MeasurementPoint }
  | { type: 'CLEAR_TARGET' }
  | { type: 'START_LLM_ESTIMATE' }
  | { type: 'LLM_ESTIMATE_COMPLETE'; estimate: LLMEstimate }
  | { type: 'LLM_ESTIMATE_FAILED'; error: string }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'START_SEARCH' }
  | { type: 'SEARCH_COMPLETE' }
  | { type: 'BACK_TO_REVIEW' }
  | { type: 'END_SESSION' };

/**
 * Initial state
 */
// Default box dimensions (40cm x 40cm x 40cm)
const DEFAULT_WIDTH_M = 0.4;
const DEFAULT_DEPTH_M = 0.4;
const DEFAULT_HEIGHT_M = 0.4;

export const initialContext: StateMachineContext = {
  state: 'IDLE',
  dragStart: null,
  dragEnd: null,
  targetPoint: null,
  floorY: null,
  floorLockPoint: null,
  height_m: DEFAULT_HEIGHT_M,
  width_m: DEFAULT_WIDTH_M,
  depth_m: DEFAULT_DEPTH_M,
  rotation_deg: 0,
  llmEstimate: null,
  isEstimating: false,
  error: null,
};

/**
 * State machine reducer
 */
export function stateMachineReducer(
  context: StateMachineContext,
  action: StateAction
): StateMachineContext {
  switch (action.type) {
    case 'START_CHECK':
      return { ...context, state: 'CHECKING_SUPPORT', error: null };

    case 'CHECK_PASSED':
      return { ...context, state: 'SUPPORTED_READY' };

    case 'CHECK_FAILED':
      return { ...context, state: 'UNSUPPORTED', error: action.error };

    case 'START_AR':
      return { ...context, state: 'AR_STARTING' };

    case 'AR_STARTED':
      return { ...context, state: 'READY_TO_DRAW' };

    case 'AR_FAILED':
      return { ...context, state: 'SUPPORTED_READY', error: action.error };

    case 'LOCK_FLOOR':
      if (context.state === 'READY_TO_DRAW') {
        return {
          ...context,
          floorY: action.floorY,
          floorLockPoint: action.position.clone(),
          state: 'FLOOR_LOCKED',
        };
      }
      return context;

    case 'PLACE_BOX': {
      // Tap to place a default-sized box centered on the tap point
      // Works from both READY_TO_DRAW (legacy) and FLOOR_LOCKED
      if (context.state === 'READY_TO_DRAW' || context.state === 'FLOOR_LOCKED') {
        const center = action.point.position;
        // Use locked floor Y if available, otherwise use tap point Y
        const baseY = context.floorY ?? center.y;
        const halfWidth = DEFAULT_WIDTH_M / 2;
        const halfDepth = DEFAULT_DEPTH_M / 2;

        const dragStart: MeasurementPoint = {
          position: new THREE.Vector3(
            center.x - halfWidth,
            baseY,
            center.z - halfDepth
          ),
          timestamp: Date.now(),
          stability: action.point.stability,
        };

        const dragEnd: MeasurementPoint = {
          position: new THREE.Vector3(
            center.x + halfWidth,
            baseY,
            center.z + halfDepth
          ),
          timestamp: Date.now(),
          stability: action.point.stability,
        };

        return {
          ...context,
          dragStart,
          dragEnd,
          width_m: DEFAULT_WIDTH_M,
          depth_m: DEFAULT_DEPTH_M,
          height_m: DEFAULT_HEIGHT_M,
          rotation_deg: 0,
          state: 'HEIGHT_INPUT',
        };
      }
      return context;
    }

    case 'PLACE_DEPTH_BOX':
      // Place a box sized from depth data (from FLOOR_LOCKED state)
      if (context.state === 'FLOOR_LOCKED') {
        return {
          ...context,
          dragStart: action.dragStart,
          dragEnd: action.dragEnd,
          width_m: action.width_m,
          depth_m: action.depth_m,
          height_m: action.height_m,
          rotation_deg: action.rotation_deg,
          llmEstimate: {
            width_cm: action.width_m * 100,
            depth_cm: action.depth_m * 100,
            height_cm: action.height_m * 100,
            confidence: action.confidence,
            objectDescription: 'Depth-sensed object',
          },
          state: 'HEIGHT_INPUT',
        };
      }
      return context;

    case 'START_DRAG':
      if (context.state === 'READY_TO_DRAW') {
        return {
          ...context,
          dragStart: action.point,
          dragEnd: action.point, // Initialize end to start
          state: 'DRAWING',
        };
      }
      return context;

    case 'UPDATE_DRAG':
      if (context.state === 'DRAWING') {
        return {
          ...context,
          dragEnd: action.point,
        };
      }
      return context;

    case 'END_DRAG':
      if (context.state === 'DRAWING' && context.dragStart) {
        // Require minimum rectangle size (at least 5cm in any direction)
        const dist = action.point.position.distanceTo(context.dragStart.position);
        if (dist < 0.05) {
          // Rectangle too small, cancel and reset
          return {
            ...context,
            dragStart: null,
            dragEnd: null,
            state: 'READY_TO_DRAW',
          };
        }
        return {
          ...context,
          dragEnd: action.point,
          state: 'HEIGHT_INPUT',
        };
      }
      return context;

    case 'SET_HEIGHT':
      return {
        ...context,
        height_m: action.height_m,
      };

    case 'SET_WIDTH':
      return {
        ...context,
        width_m: action.width_m,
      };

    case 'SET_DEPTH':
      return {
        ...context,
        depth_m: action.depth_m,
      };

    case 'SET_ROTATION':
      return {
        ...context,
        rotation_deg: action.rotation_deg,
      };

    case 'MOVE_BOX':
      // Move both dragStart and dragEnd by the same delta to shift the entire box
      if (context.dragStart && context.dragEnd) {
        return {
          ...context,
          dragStart: {
            ...context.dragStart,
            position: context.dragStart.position.clone().add(
              new THREE.Vector3(action.deltaX, 0, action.deltaZ)
            ),
            timestamp: Date.now(),
          },
          dragEnd: {
            ...context.dragEnd,
            position: context.dragEnd.position.clone().add(
              new THREE.Vector3(action.deltaX, 0, action.deltaZ)
            ),
            timestamp: Date.now(),
          },
        };
      }
      return context;

    case 'CONFIRM_HEIGHT':
      if (context.state === 'HEIGHT_INPUT') {
        return {
          ...context,
          state: 'REVIEW',
        };
      }
      return context;

    case 'SET_TARGET':
      if (context.state === 'READY_TO_DRAW') {
        return {
          ...context,
          targetPoint: action.point,
        };
      }
      return context;

    case 'CLEAR_TARGET':
      return {
        ...context,
        targetPoint: null,
      };

    case 'START_LLM_ESTIMATE':
      if (!context.targetPoint) {
        return context; // Need a target point first
      }
      return {
        ...context,
        isEstimating: true,
        error: null,
      };

    case 'LLM_ESTIMATE_COMPLETE': {
      // Use the target point as anchor, create drag points from LLM dimensions
      const { estimate } = action;
      const anchorPoint = context.targetPoint!;
      const widthM = estimate.width_cm / 100;
      const depthM = estimate.depth_cm / 100;
      const heightM = estimate.height_cm / 100;

      // Create dragStart at anchor, dragEnd offset by width/depth
      const dragEnd: MeasurementPoint = {
        position: anchorPoint.position.clone().add(
          new THREE.Vector3(widthM, 0, depthM)
        ),
        timestamp: Date.now(),
        stability: anchorPoint.stability,
      };

      return {
        ...context,
        isEstimating: false,
        llmEstimate: estimate,
        dragStart: anchorPoint,
        dragEnd: dragEnd,
        width_m: widthM,
        depth_m: depthM,
        height_m: heightM,
        state: 'HEIGHT_INPUT',
      };
    }

    case 'LLM_ESTIMATE_FAILED':
      return {
        ...context,
        isEstimating: false,
        error: action.error,
      };

    case 'UNDO':
      return handleUndo(context);

    case 'RESET':
      return {
        ...context,
        dragStart: null,
        dragEnd: null,
        targetPoint: null,
        floorY: null,
        floorLockPoint: null,
        height_m: DEFAULT_HEIGHT_M,
        width_m: DEFAULT_WIDTH_M,
        depth_m: DEFAULT_DEPTH_M,
        rotation_deg: 0,
        llmEstimate: null,
        state: 'READY_TO_DRAW',
      };

    case 'START_SEARCH':
      return { ...context, state: 'SEARCHING' };

    case 'SEARCH_COMPLETE':
      return { ...context, state: 'RESULTS' };

    case 'BACK_TO_REVIEW':
      return { ...context, state: 'REVIEW' };

    case 'END_SESSION':
      return { ...initialContext };

    default:
      return context;
  }
}

/**
 * Handle undo action
 */
function handleUndo(context: StateMachineContext): StateMachineContext {
  // In height input or review, go back to floor locked (if we have a floor) or ready to draw
  if (context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW') {
    return {
      ...context,
      dragStart: null,
      dragEnd: null,
      targetPoint: null,
      height_m: DEFAULT_HEIGHT_M,
      width_m: DEFAULT_WIDTH_M,
      depth_m: DEFAULT_DEPTH_M,
      rotation_deg: 0,
      llmEstimate: null,
      state: context.floorY !== null ? 'FLOOR_LOCKED' : 'READY_TO_DRAW',
    };
  }

  // In floor locked, clear floor data and go back to ready to draw
  if (context.state === 'FLOOR_LOCKED') {
    return {
      ...context,
      floorY: null,
      floorLockPoint: null,
      state: 'READY_TO_DRAW',
    };
  }

  // In drawing, cancel the drag and reset rotation/position
  if (context.state === 'DRAWING') {
    return {
      ...context,
      dragStart: null,
      dragEnd: null,
      rotation_deg: 0,
      state: 'READY_TO_DRAW',
    };
  }

  return context;
}

/**
 * Get UI state from machine state
 */
export function getUIState(context: StateMachineContext): UIState {
  const stateInfo = getStateInfo(context.state);

  return {
    currentStep: stateInfo.step,
    instruction: stateInfo.instruction,
    canUndo: context.dragStart !== null || context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW' || context.state === 'FLOOR_LOCKED',
    canReset: context.dragStart !== null || context.floorY !== null,
    showMeasurements: context.dragStart !== null && context.dragEnd !== null && context.state !== 'DRAWING',
    trackingWarning: null,
  };
}

/**
 * Get human-readable info for each state
 */
function getStateInfo(state: MeasurementState): {
  step: string;
  instruction: string;
} {
  switch (state) {
    case 'IDLE':
      return { step: '', instruction: 'Initializing...' };
    case 'CHECKING_SUPPORT':
      return { step: '', instruction: 'Checking device capabilities...' };
    case 'UNSUPPORTED':
      return { step: '', instruction: 'Device not supported' };
    case 'SUPPORTED_READY':
      return { step: '', instruction: 'Ready to start AR measurement' };
    case 'AR_STARTING':
      return { step: '', instruction: 'Starting AR session...' };
    case 'AR_RUNNING':
      return { step: '', instruction: 'Point at a flat surface' };
    case 'READY_TO_DRAW':
      return { step: '1/3', instruction: 'Point at the floor and tap to set the surface' };
    case 'FLOOR_LOCKED':
      return { step: '2/3', instruction: 'Point at your object and tap to measure' };
    case 'DRAWING':
      return { step: '2/3', instruction: 'Dragging corner...' };
    case 'HEIGHT_INPUT':
      return { step: '3/3', instruction: 'Adjust dimensions' };
    case 'REVIEW':
      return { step: 'Done', instruction: 'Review your measurement' };
    case 'SEARCHING':
      return { step: '', instruction: 'Searching for storage...' };
    case 'RESULTS':
      return { step: '', instruction: 'Storage options found' };
    default:
      return { step: '', instruction: '' };
  }
}

/**
 * Check if current state allows drag interaction
 */
export function canStartDrag(state: MeasurementState): boolean {
  return state === 'READY_TO_DRAW';
}

/**
 * Check if currently in drag mode
 */
export function isDragging(state: MeasurementState): boolean {
  return state === 'DRAWING';
}
