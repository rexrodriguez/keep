'use client';

import React from 'react';
import { ComputedMeasurements, ConfidenceLevel } from '@/lib/types';
import { StateMachineContext } from '@/lib/measurement/state-machine';
import { StabilityMode } from '@/lib/measurement/stabilization';

interface MeasurementUIProps {
  context: StateMachineContext;
  measurements: ComputedMeasurements | null;
  confidence: ConfidenceLevel | null;
  trackingWarning: string | null;
  stabilityMode: StabilityMode;
  isManipulating?: boolean;
  onUndo: () => void;
  onReset: () => void;
  onConfirmHeight: () => void;
  onFindStorage: () => void;
  onSetStabilityMode: (mode: StabilityMode) => void;
  onExit: () => void;
}

export default function MeasurementUI({
  context,
  measurements,
  confidence,
  trackingWarning,
  onUndo,
  onReset,
  onConfirmHeight,
  onFindStorage,
  onExit,
}: MeasurementUIProps) {
  const isHeightInput = context.state === 'HEIGHT_INPUT';
  const isReview = context.state === 'REVIEW';
  const isDrawing = context.state === 'DRAWING';
  const isReadyToDraw = context.state === 'READY_TO_DRAW';
  const showBottomPanel = isHeightInput || isReview;

  // Convert dimensions to inches for display (1 meter = 39.3701 inches)
  const widthInches = Math.round(context.width_m * 39.3701);
  const depthInches = Math.round(context.depth_m * 39.3701);
  const heightInches = Math.round(context.height_m * 39.3701);

  // Show confirmation popup when entering REVIEW state
  const [showConfirmPopup, setShowConfirmPopup] = React.useState(false);
  const prevStateRef = React.useRef(context.state);

  React.useEffect(() => {
    // Detect transition from HEIGHT_INPUT to REVIEW
    if (prevStateRef.current === 'HEIGHT_INPUT' && context.state === 'REVIEW') {
      setShowConfirmPopup(true);
      // Auto-hide after 2 seconds
      const timer = setTimeout(() => setShowConfirmPopup(false), 2000);
      return () => clearTimeout(timer);
    }
    prevStateRef.current = context.state;
  }, [context.state]);

  // Fade UI after inactivity to let AR breathe
  const [isIdle, setIsIdle] = React.useState(false);
  const idleTimeoutRef = React.useRef<number | null>(null);

  const resetIdleTimer = React.useCallback(() => {
    setIsIdle(false);
    if (idleTimeoutRef.current) {
      clearTimeout(idleTimeoutRef.current);
    }
    // Fade after 3 seconds of inactivity
    idleTimeoutRef.current = window.setTimeout(() => {
      setIsIdle(true);
    }, 3000);
  }, []);

  // Reset timer on dimension/rotation changes
  React.useEffect(() => {
    if (showBottomPanel) {
      resetIdleTimer();
    }
    return () => {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
    };
  }, [showBottomPanel, widthInches, depthInches, heightInches, context.rotation_deg, resetIdleTimer]);

  return (
    <div
      className="fixed inset-0 pointer-events-none flex flex-col justify-between"
      onTouchStart={resetIdleTimer}
      onTouchMove={resetIdleTimer}
    >
      {/* Minimal top bar - just close button and warnings */}
      <div className="pointer-events-auto p-3 safe-area-top">
        <div className="flex items-start justify-between">
          <button
            onClick={onExit}
            className="bg-black/50 backdrop-blur-sm text-white/80 hover:text-white p-2 rounded-full"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Floating dimension display when adjusting */}
          {showBottomPanel && measurements && (
            <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2">
              <div className="flex items-center gap-3 text-sm text-white">
                <span>{widthInches}"</span>
                <span className="text-white/40">×</span>
                <span>{depthInches}"</span>
                <span className="text-white/40">×</span>
                <span>{heightInches}"</span>
              </div>
            </div>
          )}

          {/* Spacer for symmetry */}
          <div className="w-9" />
        </div>

        {/* Tracking warning - only show when relevant */}
        {trackingWarning && !context.isEstimating && (isReadyToDraw || isDrawing) && (
          <div className="mt-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-3 py-2 mx-auto max-w-xs">
            <p className="text-yellow-200 text-xs text-center">
              {trackingWarning}
            </p>
          </div>
        )}

        {/* Error message */}
        {context.error && (
          <div className="mt-2 bg-red-500/20 border border-red-500/40 rounded-lg px-3 py-2 mx-auto max-w-xs">
            <p className="text-red-200 text-xs text-center">
              {context.error}
            </p>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1 flex items-center justify-center">
        {/* Confirmation popup - appears briefly when dimensions are confirmed */}
        {showConfirmPopup && (
          <div className="bg-black/80 backdrop-blur-md rounded-2xl px-6 py-4 text-center animate-fade-in-out">
            <div className="text-white/60 text-xs uppercase tracking-wider mb-2">Confirmed</div>
            <div className="text-white text-2xl font-semibold">
              <span className="text-cyan-400">{widthInches}″</span>
              <span className="text-white/40 mx-1">×</span>
              <span className="text-cyan-400">{depthInches}″</span>
              <span className="text-white/40 mx-1">×</span>
              <span className="text-purple-400">{heightInches}″</span>
            </div>
            <div className="text-white/50 text-sm mt-1">
              {((widthInches * depthInches * heightInches) / 1728).toFixed(2)} ft³
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel - Adjustment controls (fades when idle to let AR breathe) */}
      {showBottomPanel && (
        <div
          className={`pointer-events-auto bg-black/80 backdrop-blur-md rounded-t-2xl safe-area-bottom transition-opacity duration-500 ${
            isIdle ? 'opacity-40' : 'opacity-100'
          }`}
          onTouchStart={resetIdleTimer}
        >
          {isHeightInput && (
            <AdjustmentPanel
              onUndo={onUndo}
              onConfirm={onConfirmHeight}
            />
          )}

          {isReview && measurements && (
            <ReviewPanel
              measurements={measurements}
              confidence={confidence}
              onRedo={onReset}
              onFindStorage={onFindStorage}
            />
          )}
        </div>
      )}

      {/* Floating hints for initial states */}
      {isReadyToDraw && !trackingWarning && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm">
              Tap to place a box
            </span>
          </div>
        </div>
      )}

      {isDrawing && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm">
              Drag to resize
            </span>
          </div>
        </div>
      )}

      {context.isEstimating && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-white text-sm">Analyzing...</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Adjustment Panel - Simplified for direct manipulation
// ============================================================================

function AdjustmentPanel({
  onUndo,
  onConfirm,
}: {
  onUndo: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-4">
      <div className="flex gap-3">
        <button
          onClick={onUndo}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
        >
          Redo
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Review Panel - Show final measurements and actions
// ============================================================================

// Helper to format inches as feet and inches (e.g., 27" -> 2'3")
function formatFeetInches(totalInches: number): string {
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  if (feet === 0) return `${inches}"`;
  if (inches === 0) return `${feet}'`;
  return `${feet}'${inches}"`;
}

// Helper to calculate volume in cubic feet
function calculateCubicFeet(widthIn: number, depthIn: number, heightIn: number): number {
  return (widthIn * depthIn * heightIn) / 1728; // 1728 cubic inches per cubic foot
}

function ReviewPanel({
  measurements,
  confidence,
  onRedo,
  onFindStorage,
}: {
  measurements: ComputedMeasurements;
  confidence: ConfidenceLevel | null;
  onRedo: () => void;
  onFindStorage: () => void;
}) {
  // Convert cm to inches
  const widthIn = measurements.width_cm / 2.54;
  const depthIn = measurements.depth_cm / 2.54;
  const heightIn = measurements.height_cm / 2.54;
  const volumeCuFt = calculateCubicFeet(widthIn, depthIn, heightIn);

  return (
    <div className="p-4">
      {/* Measurements summary */}
      <div className="bg-white/5 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/60 text-sm">Dimensions</span>
          {confidence && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                confidence === 'HIGH'
                  ? 'bg-green-500/20 text-green-400'
                  : confidence === 'MEDIUM'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {confidence.toLowerCase()} confidence
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <div className="text-white text-xl font-bold">{formatFeetInches(widthIn)}</div>
            <div className="text-white/50 text-xs">Width</div>
          </div>
          <div>
            <div className="text-white text-xl font-bold">{formatFeetInches(depthIn)}</div>
            <div className="text-white/50 text-xs">Depth</div>
          </div>
          <div>
            <div className="text-white text-xl font-bold">{formatFeetInches(heightIn)}</div>
            <div className="text-white/50 text-xs">Height</div>
          </div>
          <div>
            <div className="text-white text-xl font-bold">{volumeCuFt.toFixed(1)}</div>
            <div className="text-white/50 text-xs">cu ft</div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onRedo}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
        >
          Measure Again
        </button>
        <button
          onClick={onFindStorage}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
        >
          Find Storage
        </button>
      </div>
    </div>
  );
}
