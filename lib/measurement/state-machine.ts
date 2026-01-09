import { MeasurementState, MeasurementPoint, UIState } from '@/lib/types';

export interface StateMachineContext {
  state: MeasurementState;
  basePoints: MeasurementPoint[];
  heightPoint: MeasurementPoint | null;
  error: string | null;
}

export type StateAction =
  | { type: 'START_CHECK' }
  | { type: 'CHECK_PASSED' }
  | { type: 'CHECK_FAILED'; error: string }
  | { type: 'START_AR' }
  | { type: 'AR_STARTED' }
  | { type: 'AR_FAILED'; error: string }
  | { type: 'ADD_BASE_POINT'; point: MeasurementPoint }
  | { type: 'ADD_HEIGHT_POINT'; point: MeasurementPoint }
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
  basePoints: [],
  heightPoint: null,
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
      return { ...context, state: 'BASE_P1' };

    case 'AR_FAILED':
      return { ...context, state: 'SUPPORTED_READY', error: action.error };

    case 'ADD_BASE_POINT':
      const newBasePoints = [...context.basePoints, action.point];
      const nextBaseState = getNextBaseState(newBasePoints.length);
      return {
        ...context,
        basePoints: newBasePoints,
        state: nextBaseState,
      };

    case 'ADD_HEIGHT_POINT':
      return {
        ...context,
        heightPoint: action.point,
        state: 'REVIEW',
      };

    case 'UNDO':
      return handleUndo(context);

    case 'RESET':
      return {
        ...context,
        basePoints: [],
        heightPoint: null,
        state: 'BASE_P1',
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
 * Get the next state based on number of base points
 */
function getNextBaseState(pointCount: number): MeasurementState {
  switch (pointCount) {
    case 1:
      return 'BASE_P2';
    case 2:
      return 'BASE_P3';
    case 3:
      return 'BASE_P4';
    case 4:
      return 'HEIGHT';
    default:
      return 'BASE_P1';
  }
}

/**
 * Handle undo action
 */
function handleUndo(context: StateMachineContext): StateMachineContext {
  if (context.heightPoint) {
    // Undo height point
    return {
      ...context,
      heightPoint: null,
      state: 'HEIGHT',
    };
  }

  if (context.basePoints.length > 0) {
    // Undo last base point
    const newBasePoints = context.basePoints.slice(0, -1);
    return {
      ...context,
      basePoints: newBasePoints,
      state: getStateForPointCount(newBasePoints.length),
    };
  }

  return context;
}

/**
 * Get state for a given point count
 */
function getStateForPointCount(count: number): MeasurementState {
  switch (count) {
    case 0:
      return 'BASE_P1';
    case 1:
      return 'BASE_P2';
    case 2:
      return 'BASE_P3';
    case 3:
      return 'BASE_P4';
    case 4:
      return 'HEIGHT';
    default:
      return 'BASE_P1';
  }
}

/**
 * Get UI state from machine state
 */
export function getUIState(context: StateMachineContext): UIState {
  const stateInfo = getStateInfo(context.state);

  return {
    currentStep: stateInfo.step,
    instruction: stateInfo.instruction,
    canUndo: context.basePoints.length > 0 || context.heightPoint !== null,
    canReset: context.basePoints.length > 0,
    showMeasurements: context.basePoints.length >= 2,
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
      return { step: '0/5', instruction: 'Point at a flat surface' };
    case 'BASE_P1':
      return { step: '1/5', instruction: 'Tap the FRONT-LEFT corner' };
    case 'BASE_P2':
      return { step: '2/5', instruction: 'Tap the FRONT-RIGHT corner' };
    case 'BASE_P3':
      return { step: '3/5', instruction: 'Tap the BACK-RIGHT corner' };
    case 'BASE_P4':
      return { step: '4/5', instruction: 'Tap the BACK-LEFT corner' };
    case 'HEIGHT':
      return { step: '5/5', instruction: 'Tap the TOP of the object' };
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
  return ['BASE_P1', 'BASE_P2', 'BASE_P3', 'BASE_P4', 'HEIGHT'].includes(state);
}

/**
 * Check if current state is capturing base points
 */
export function isCapturingBase(state: MeasurementState): boolean {
  return ['BASE_P1', 'BASE_P2', 'BASE_P3', 'BASE_P4'].includes(state);
}
