import { MeasurementState, MeasurementPoint, UIState } from '@/lib/types';

export interface StateMachineContext {
  state: MeasurementState;
  floorPoint1: MeasurementPoint | null;  // First floor corner
  floorPoint2: MeasurementPoint | null;  // Diagonal floor corner
  height_m: number;                       // User-adjusted height (default 0.5m)
  error: string | null;
}

export type StateAction =
  | { type: 'START_CHECK' }
  | { type: 'CHECK_PASSED' }
  | { type: 'CHECK_FAILED'; error: string }
  | { type: 'START_AR' }
  | { type: 'AR_STARTED' }
  | { type: 'AR_FAILED'; error: string }
  | { type: 'ADD_FLOOR_POINT'; point: MeasurementPoint }
  | { type: 'SET_HEIGHT'; height_m: number }
  | { type: 'CONFIRM_HEIGHT' }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'START_SEARCH' }
  | { type: 'SEARCH_COMPLETE' }
  | { type: 'BACK_TO_REVIEW' }
  | { type: 'END_SESSION' };

/**
 * Initial state
 */
export const initialContext: StateMachineContext = {
  state: 'IDLE',
  floorPoint1: null,
  floorPoint2: null,
  height_m: 0.5, // Default 50cm
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
      return { ...context, state: 'FLOOR_1' };

    case 'AR_FAILED':
      return { ...context, state: 'SUPPORTED_READY', error: action.error };

    case 'ADD_FLOOR_POINT':
      if (context.state === 'FLOOR_1') {
        return {
          ...context,
          floorPoint1: action.point,
          state: 'FLOOR_2',
        };
      } else if (context.state === 'FLOOR_2') {
        // Require minimum distance between points (at least 5cm apart)
        if (context.floorPoint1) {
          const dist = action.point.position.distanceTo(context.floorPoint1.position);
          if (dist < 0.05) {
            // Points too close, ignore this tap
            return context;
          }
        }
        return {
          ...context,
          floorPoint2: action.point,
          state: 'HEIGHT_INPUT',
        };
      }
      return context;

    case 'SET_HEIGHT':
      return {
        ...context,
        height_m: action.height_m,
      };

    case 'CONFIRM_HEIGHT':
      if (context.state === 'HEIGHT_INPUT') {
        return {
          ...context,
          state: 'REVIEW',
        };
      }
      return context;

    case 'UNDO':
      return handleUndo(context);

    case 'RESET':
      return {
        ...context,
        floorPoint1: null,
        floorPoint2: null,
        height_m: 0.5,
        state: 'FLOOR_1',
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
  // In height input or review, go back to floor 2
  if (context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW') {
    return {
      ...context,
      floorPoint2: null,
      height_m: 0.5,
      state: 'FLOOR_2',
    };
  }

  // In floor 2, go back to floor 1
  if (context.floorPoint2) {
    return {
      ...context,
      floorPoint2: null,
      state: 'FLOOR_2',
    };
  }

  // Undo first floor point
  if (context.floorPoint1) {
    return {
      ...context,
      floorPoint1: null,
      state: 'FLOOR_1',
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
    canUndo: context.floorPoint1 !== null,
    canReset: context.floorPoint1 !== null,
    showMeasurements: context.floorPoint1 !== null && context.floorPoint2 !== null,
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
    case 'FLOOR_1':
      return { step: '1/3', instruction: 'Tap one corner of the object base' };
    case 'FLOOR_2':
      return { step: '2/3', instruction: 'Tap the diagonal opposite corner' };
    case 'HEIGHT_INPUT':
      return { step: '3/3', instruction: 'Adjust height with slider' };
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
 * Check if current state allows point capture (floor taps only)
 */
export function canCapturePoint(state: MeasurementState): boolean {
  return ['FLOOR_1', 'FLOOR_2'].includes(state);
}
