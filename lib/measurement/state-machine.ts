import { MeasurementState, MeasurementPoint, UIState } from '@/lib/types';

export interface StateMachineContext {
  state: MeasurementState;
  corner1: MeasurementPoint | null;  // Bottom-front corner
  corner2: MeasurementPoint | null;  // Top-back diagonal corner
  error: string | null;
}

export type StateAction =
  | { type: 'START_CHECK' }
  | { type: 'CHECK_PASSED' }
  | { type: 'CHECK_FAILED'; error: string }
  | { type: 'START_AR' }
  | { type: 'AR_STARTED' }
  | { type: 'AR_FAILED'; error: string }
  | { type: 'ADD_CORNER'; point: MeasurementPoint }
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
  corner1: null,
  corner2: null,
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
      return { ...context, state: 'CORNER_1' };

    case 'AR_FAILED':
      return { ...context, state: 'SUPPORTED_READY', error: action.error };

    case 'ADD_CORNER':
      if (context.state === 'CORNER_1') {
        return {
          ...context,
          corner1: action.point,
          state: 'CORNER_2',
        };
      } else if (context.state === 'CORNER_2') {
        return {
          ...context,
          corner2: action.point,
          state: 'REVIEW',
        };
      }
      return context;

    case 'UNDO':
      return handleUndo(context);

    case 'RESET':
      return {
        ...context,
        corner1: null,
        corner2: null,
        state: 'CORNER_1',
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
  if (context.corner2) {
    // Undo second corner
    return {
      ...context,
      corner2: null,
      state: 'CORNER_2',
    };
  }

  if (context.corner1) {
    // Undo first corner
    return {
      ...context,
      corner1: null,
      state: 'CORNER_1',
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
    canUndo: context.corner1 !== null,
    canReset: context.corner1 !== null,
    showMeasurements: context.corner1 !== null && context.corner2 !== null,
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
    case 'CORNER_1':
      return { step: '1/2', instruction: 'Tap the BOTTOM corner of the object' };
    case 'CORNER_2':
      return { step: '2/2', instruction: 'Tap the opposite TOP corner' };
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
 * Check if current state allows point capture
 */
export function canCapturePoint(state: MeasurementState): boolean {
  return ['CORNER_1', 'CORNER_2'].includes(state);
}
