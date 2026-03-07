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
  hasDepth?: boolean;
  onReset: () => void;
  onConfirmHeight: () => void;
  onAddItem: () => void;
  onDone: () => void;
  itemCount: number;
  onSetStabilityMode: (mode: StabilityMode) => void;
  onExit: () => void;
}

export default function MeasurementUI({
  context,
  measurements,
  confidence,
  trackingWarning,
  hasDepth,
  onReset,
  onConfirmHeight,
  onAddItem,
  onDone,
  itemCount,
  onExit,
}: MeasurementUIProps) {
  const isHeightInput = context.state === 'HEIGHT_INPUT';
  const isReview = context.state === 'REVIEW';
  const isDrawing = context.state === 'DRAWING';
  const isReadyToDraw = context.state === 'READY_TO_DRAW';
  const isFloorLocked = context.state === 'FLOOR_LOCKED';
  const isMeasuring = context.state === 'MEASURING';
  const showBottomPanel = isHeightInput || isReview;

  // Convert dimensions to inches for display (1 meter = 39.3701 inches)
  const widthInches = Math.round(context.width_m * 39.3701);
  const depthInches = Math.round(context.depth_m * 39.3701);
  const heightInches = Math.round(context.height_m * 39.3701);

  // Show confirmation popup when entering REVIEW state
  const [showConfirmPopup, setShowConfirmPopup] = React.useState(false);
  // Show "Added!" toast when item is added (REVIEW → READY_TO_DRAW transition)
  const [showAddedToast, setShowAddedToast] = React.useState(false);
  const prevStateRef = React.useRef(context.state);
  const prevItemCountRef = React.useRef(itemCount);

  React.useEffect(() => {
    // Detect transition from HEIGHT_INPUT to REVIEW
    if (prevStateRef.current === 'HEIGHT_INPUT' && context.state === 'REVIEW') {
      setShowConfirmPopup(true);
      const timer = setTimeout(() => setShowConfirmPopup(false), 2000);
      prevStateRef.current = context.state;
      return () => clearTimeout(timer);
    }
    // Detect item added (REVIEW → READY_TO_DRAW with itemCount increase)
    if (prevStateRef.current === 'REVIEW' && context.state === 'READY_TO_DRAW' && itemCount > prevItemCountRef.current) {
      setShowAddedToast(true);
      const timer = setTimeout(() => setShowAddedToast(false), 1500);
      prevStateRef.current = context.state;
      prevItemCountRef.current = itemCount;
      return () => clearTimeout(timer);
    }
    prevStateRef.current = context.state;
    prevItemCountRef.current = itemCount;
  }, [context.state, itemCount]);

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
            onTouchEnd={(e) => { e.preventDefault(); onExit(); }}
            className="bg-black/50 backdrop-blur-sm text-white/80 hover:text-white p-2 rounded-full"
            style={{ touchAction: 'manipulation' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Item counter pill */}
          {itemCount > 0 && (
            <span className="bg-black/50 backdrop-blur-sm text-white/80 px-3 py-1.5 rounded-full text-sm">
              {itemCount} item{itemCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Floating dimension display when adjusting */}
          {showBottomPanel && measurements && (
            <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2">
              <div className="flex items-center gap-3 text-sm text-white">
                <span>{widthInches}&quot;</span>
                <span className="text-white/40">&times;</span>
                <span>{depthInches}&quot;</span>
                <span className="text-white/40">&times;</span>
                <span>{heightInches}&quot;</span>
              </div>
            </div>
          )}

          {/* Spacer for symmetry */}
          {itemCount === 0 && <div className="w-9" />}
        </div>

        {/* Tracking warning - only show when relevant */}
        {trackingWarning && !context.isEstimating && (isReadyToDraw || isFloorLocked || isMeasuring || isDrawing) && (
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

        {/* Debug overlay for depth diagnostics */}
        {context.depthDebug && (
          <div className="mt-2 px-2">
            <div className="bg-black/80 rounded-lg px-2 py-1.5 max-w-sm">
              <pre className="text-green-400 text-[10px] leading-tight font-mono whitespace-pre-wrap">
                {context.depthDebug}
              </pre>
            </div>
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
        {showAddedToast && (
          <div className="bg-green-500/90 backdrop-blur-md rounded-2xl px-6 py-3 text-center animate-fade-in-out">
            <div className="text-white font-medium">Added to list</div>
            <div className="text-white/80 text-sm">Tap Done when finished</div>
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
              onConfirm={onConfirmHeight}
              onUndo={onReset}
            />
          )}

          {isReview && measurements && (
            <ReviewPanel
              measurements={measurements}
              confidence={confidence}
              onRedo={onReset}
              onAddItem={onAddItem}
            />
          )}
        </div>
      )}

      {/* Floating hints for initial states */}
      {isReadyToDraw && !trackingWarning && itemCount === 0 && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm">
              Point at the floor and tap to set the surface
            </span>
          </div>
        </div>
      )}

      {/* After adding items: prominent Done button + hint */}
      {isReadyToDraw && !trackingWarning && itemCount > 0 && (
        <div className="pointer-events-auto pb-8 px-4 safe-area-bottom">
          <div className="flex flex-col items-center gap-3">
            <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full">
              <span className="text-white text-sm">
                Measure another item, or tap Done
              </span>
            </div>
            <button
              onClick={onDone}
              onTouchEnd={(e) => { e.preventDefault(); onDone(); }}
              className="w-48 py-3 rounded-xl font-medium text-base bg-blue-500 text-white active:bg-blue-600 transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              Done ({itemCount} item{itemCount !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      )}

      {isFloorLocked && !trackingWarning && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm">
              Point at your object and tap to measure
            </span>
          </div>
          {hasDepth && (
            <div className="text-xs text-cyan-400 mt-1 text-center">
              Depth sensing active
            </div>
          )}
          {!hasDepth && (
            <div className="text-xs text-amber-400 mt-1 text-center">
              Manual mode — adjust box size after placing
            </div>
          )}
        </div>
      )}

      {isMeasuring && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-black/60 backdrop-blur-sm px-4 py-3 rounded-full mx-auto w-fit flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
            <span className="text-white text-sm">Measuring...</span>
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
  onConfirm,
  onUndo,
}: {
  onConfirm: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="p-3 flex gap-3">
      <button
        onClick={onUndo}
        onTouchEnd={(e) => { e.preventDefault(); onUndo(); }}
        className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
        style={{ touchAction: 'manipulation' }}
      >
        Undo
      </button>
      <button
        onClick={onConfirm}
        onTouchEnd={(e) => { e.preventDefault(); onConfirm(); }}
        className="flex-1 py-3 px-6 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
        style={{ touchAction: 'manipulation' }}
      >
        Confirm Dimensions
      </button>
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
  onAddItem,
}: {
  measurements: ComputedMeasurements;
  confidence: ConfidenceLevel | null;
  onRedo: () => void;
  onAddItem: () => void;
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
          onTouchEnd={(e) => { e.preventDefault(); onRedo(); }}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-white/10 text-white active:bg-white/20 transition-colors"
          style={{ touchAction: 'manipulation' }}
        >
          Undo
        </button>
        <button
          onClick={onAddItem}
          onTouchEnd={(e) => { e.preventDefault(); onAddItem(); }}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-blue-500 text-white active:bg-blue-600 transition-colors"
          style={{ touchAction: 'manipulation' }}
        >
          Add to List
        </button>
      </div>
    </div>
  );
}
