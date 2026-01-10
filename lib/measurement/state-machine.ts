import { MeasurementState, MeasurementPoint, UIState } from '@/lib/types';

export interface StateMachineContext {
  state: MeasurementState;
  dragStart: MeasurementPoint | null;   // Start corner of drag rectangle
  dragEnd: MeasurementPoint | null;     // End corner of drag rectangle
  height_m: number;                      // User-adjusted height (default 0.5m)
  error: string | null;
}

export type StateAction =
  | { type: 'START_CHECK' }
  | { type: 'CHECK_PASSED' }
  | { type: 'CHECK_FAILED'; error: string }
  | { type: 'START_AR' }
  | { type: 'AR_STARTED' }
  | { type: 'AR_FAILED'; error: string }
  | { type: 'START_DRAG'; point: MeasurementPoint }
  | { type: 'UPDATE_DRAG'; point: MeasurementPoint }
  | { type: 'END_DRAG'; point: MeasurementPoint }
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
  dragStart: null,
  dragEnd: null,
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
      return { ...context, state: 'READY_TO_DRAW' };

    case 'AR_FAILED':
      return { ...context, state: 'SUPPORTED_READY', error: action.error };

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
        dragStart: null,
        dragEnd: null,
        height_m: 0.5,
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
  // In height input or review, go back to ready to draw
  if (context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW') {
    return {
      ...context,
      dragStart: null,
      dragEnd: null,
      height_m: 0.5,
      state: 'READY_TO_DRAW',
    };
  }

  // In drawing, cancel the drag
  if (context.state === 'DRAWING') {
    return {
      ...context,
      dragStart: null,
      dragEnd: null,
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
    canUndo: context.dragStart !== null || context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW',
    canReset: context.dragStart !== null,
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
      return { step: '1/2', instruction: 'Drag to draw rectangle around object base' };
    case 'DRAWING':
      return { step: '1/2', instruction: 'Release to set rectangle' };
    case 'HEIGHT_INPUT':
      return { step: '2/2', instruction: 'Adjust height' };
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
