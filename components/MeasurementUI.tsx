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
  onUndo: () => void;
  onReset: () => void;
  onSetWidth: (width_m: number) => void;
  onSetDepth: (depth_m: number) => void;
  onSetHeight: (height_m: number) => void;
  onSetRotation: (rotation_deg: number) => void;
  onMoveBox: (deltaX: number, deltaZ: number) => void;
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
  onSetWidth,
  onSetDepth,
  onSetHeight,
  onSetRotation,
  onMoveBox,
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
      className="fixed inset-0 pointer-events-none flex flex-col"
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
              widthInches={widthInches}
              depthInches={depthInches}
              heightInches={heightInches}
              rotationDeg={context.rotation_deg}
              onSetWidth={(inches) => onSetWidth(inches * 0.0254)}
              onSetDepth={(inches) => onSetDepth(inches * 0.0254)}
              onSetHeight={(inches) => onSetHeight(inches * 0.0254)}
              onSetRotation={onSetRotation}
              onMoveBox={onMoveBox}
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
// Adjustment Panel - All-in-one controls for dimensions and position
// ============================================================================

function AdjustmentPanel({
  widthInches,
  depthInches,
  heightInches,
  rotationDeg,
  onSetWidth,
  onSetDepth,
  onSetHeight,
  onSetRotation,
  onMoveBox,
  onUndo,
  onConfirm,
}: {
  widthInches: number;
  depthInches: number;
  heightInches: number;
  rotationDeg: number;
  onSetWidth: (inches: number) => void;
  onSetDepth: (inches: number) => void;
  onSetHeight: (inches: number) => void;
  onSetRotation: (deg: number) => void;
  onMoveBox: (deltaX: number, deltaZ: number) => void;
  onUndo: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-4">
      {/* Dimensions - Footprint (W×D) grouped, Height separate */}
      <div className="flex gap-3 mb-4">
        {/* Footprint group - Width & Depth in cyan/teal */}
        <div className="flex-1 bg-cyan-500/10 rounded-xl p-3">
          <div className="text-cyan-400/60 text-[10px] uppercase tracking-wider mb-2 text-center">Footprint</div>
          <div className="flex gap-2">
            <DimensionStepper
              label="W"
              value={widthInches}
              onChange={onSetWidth}
              color="cyan"
            />
            <DimensionStepper
              label="D"
              value={depthInches}
              onChange={onSetDepth}
              color="cyan"
            />
          </div>
        </div>

        {/* Height - distinct purple */}
        <div className="bg-purple-500/10 rounded-xl p-3">
          <div className="text-purple-400/60 text-[10px] uppercase tracking-wider mb-2 text-center">Height</div>
          <DimensionStepper
            label="H"
            value={heightInches}
            onChange={onSetHeight}
            color="purple"
          />
        </div>
      </div>

      {/* Position controls - joystick and rotation */}
      <div className="flex items-center justify-center gap-6 mb-4">
        <div className="text-center">
          <Joystick onMove={onMoveBox} />
          <span className="text-white/40 text-[10px] mt-1 block uppercase tracking-wider">Move</span>
        </div>
        <div className="text-center">
          <RotationDial value={rotationDeg} onChange={onSetRotation} />
          <span className="text-white/40 text-[10px] mt-1 block uppercase tracking-wider">Rotate</span>
        </div>
      </div>

      {/* Action buttons */}
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
// Dimension Stepper - Press-and-hold with acceleration
// ============================================================================

function DimensionStepper({
  label,
  value,
  onChange,
  color,
  min = 1,
  max = 200,
}: {
  label: string;
  value: number;
  onChange: (inches: number) => void;
  color: 'cyan' | 'purple';
  min?: number;
  max?: number;
}) {
  const colorClasses = {
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
  };

  // Press-and-hold with acceleration
  const intervalRef = React.useRef<number | null>(null);
  const timeoutRef = React.useRef<number | null>(null);
  const localValueRef = React.useRef(value);
  const tickCountRef = React.useRef(0);

  // Keep ref in sync with prop
  React.useEffect(() => {
    localValueRef.current = value;
  }, [value]);

  const stopAdjusting = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    tickCountRef.current = 0;
  };

  // Calculate step size based on hold duration (acceleration)
  // 0-10 ticks: 1", 10-25 ticks: 2", 25-50 ticks: 6", 50+: 12"
  const getStepSize = (ticks: number): number => {
    if (ticks < 10) return 1;
    if (ticks < 25) return 2;
    if (ticks < 50) return 6;
    return 12;
  };

  const startContinuousAdjust = (direction: 1 | -1) => {
    // Immediate single step on tap
    const newVal = Math.max(min, Math.min(max, localValueRef.current + direction));
    localValueRef.current = newVal;
    onChange(newVal);
    tickCountRef.current = 0;

    // Start continuous adjustment after initial delay
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        tickCountRef.current++;
        const step = getStepSize(tickCountRef.current);
        const nextVal = Math.max(min, Math.min(max, localValueRef.current + direction * step));

        if (nextVal !== localValueRef.current) {
          localValueRef.current = nextVal;
          onChange(nextVal);
        }
      }, 60); // ~16fps for smooth feel
    }, 250); // Shorter initial delay for responsiveness
  };

  React.useEffect(() => {
    return () => {
      stopAdjusting();
    };
  }, []);

  // Minimal chrome - number is the hero
  return (
    <div className="flex items-center gap-1">
      <button
        onPointerDown={() => startContinuousAdjust(-1)}
        onPointerUp={stopAdjusting}
        onPointerLeave={stopAdjusting}
        onPointerCancel={stopAdjusting}
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${colorClasses[color]} opacity-50 active:opacity-100 select-none touch-none`}
      >
        −
      </button>
      <div className="text-center min-w-[3rem]">
        <span className={`text-xl font-semibold ${colorClasses[color]}`}>{value}</span>
        <span className="text-white/30 text-[10px] ml-0.5">{label}</span>
      </div>
      <button
        onPointerDown={() => startContinuousAdjust(1)}
        onPointerUp={stopAdjusting}
        onPointerLeave={stopAdjusting}
        onPointerCancel={stopAdjusting}
        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${colorClasses[color]} opacity-50 active:opacity-100 select-none touch-none`}
      >
        +
      </button>
    </div>
  );
}

// ============================================================================
// Joystick - Continuous position control
// ============================================================================

function Joystick({
  onMove,
}: {
  onMove: (deltaX: number, deltaZ: number) => void;
}) {
  const areaRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const intervalRef = React.useRef<number | null>(null);
  const positionRef = React.useRef({ x: 0, y: 0 });
  const onMoveRef = React.useRef(onMove);
  const [isActive, setIsActive] = React.useState(false);

  React.useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  const maxRadius = 36;

  const updateThumbPosition = React.useCallback((clientX: number, clientY: number) => {
    if (!areaRef.current || !thumbRef.current) return;

    const rect = areaRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = clientX - centerX;
    let dy = clientY - centerY;

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    positionRef.current = { x: dx, y: dy };
    thumbRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  const startContinuousMove = React.useCallback(() => {
    if (intervalRef.current) return;

    intervalRef.current = window.setInterval(() => {
      const { x, y } = positionRef.current;
      if (x === 0 && y === 0) return;

      const normalizedX = x / maxRadius;
      const normalizedY = y / maxRadius;
      const speed = 0.006; // meters per tick (reduced from 0.015)

      // Map joystick axes to world movement:
      // Joystick X (left/right) → deltaX (left/right on plane)
      // Joystick Y (up/down) → deltaZ (forward/back), inverted so up = forward
      onMoveRef.current(normalizedX * speed, -normalizedY * speed);
    }, 1000 / 60);
  }, []);

  const stopContinuousMove = React.useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    positionRef.current = { x: 0, y: 0 };
    if (thumbRef.current) {
      thumbRef.current.style.transform = 'translate(0px, 0px)';
    }
    setIsActive(false);
  }, []);

  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsActive(true);
    updateThumbPosition(e.clientX, e.clientY);
    startContinuousMove();
  }, [updateThumbPosition, startContinuousMove]);

  const handlePointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!isActive) return;
    updateThumbPosition(e.clientX, e.clientY);
  }, [isActive, updateThumbPosition]);

  const handlePointerUp = React.useCallback(() => {
    stopContinuousMove();
  }, [stopContinuousMove]);

  React.useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={areaRef}
      className="relative w-20 h-20 rounded-full cursor-pointer select-none touch-none"
      style={{
        background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)',
        border: '2px solid rgba(59,130,246,0.3)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Direction indicators */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <svg className="w-full h-full text-blue-500/20" viewBox="0 0 80 80">
          <path d="M40 12 L44 20 L36 20 Z" fill="currentColor" />
          <path d="M40 68 L44 60 L36 60 Z" fill="currentColor" />
          <path d="M12 40 L20 36 L20 44 Z" fill="currentColor" />
          <path d="M68 40 L60 36 L60 44 Z" fill="currentColor" />
        </svg>
      </div>
      {/* Thumb */}
      <div
        ref={thumbRef}
        className={`absolute rounded-full transition-colors ${
          isActive ? 'bg-blue-500 shadow-lg shadow-blue-500/50' : 'bg-blue-400/80'
        }`}
        style={{
          width: 28,
          height: 28,
          left: '50%',
          top: '50%',
          marginLeft: -14,
          marginTop: -14,
        }}
      />
    </div>
  );
}

// ============================================================================
// Rotation Dial - Touch to set rotation angle
// ============================================================================

function RotationDial({
  value,
  onChange,
}: {
  value: number;
  onChange: (deg: number) => void;
}) {
  const dialRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateRotation(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateRotation(e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const updateRotation = (e: React.PointerEvent) => {
    if (!dialRef.current) return;
    const rect = dialRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;

    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    onChange(Math.round(angle));
  };

  const dialRadius = 40;

  return (
    <div
      ref={dialRef}
      className="relative cursor-pointer select-none touch-none"
      style={{ width: dialRadius * 2, height: dialRadius * 2 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Outer ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(168,85,247,0.05) 100%)',
          border: '2px solid rgba(168,85,247,0.3)',
        }}
      />

      {/* Degree markers */}
      {[0, 90, 180, 270].map((deg) => {
        const rad = (deg - 90) * (Math.PI / 180);
        const x = dialRadius + Math.cos(rad) * (dialRadius - 8);
        const y = dialRadius + Math.sin(rad) * (dialRadius - 8);
        return (
          <div
            key={deg}
            className="absolute w-1 h-1 rounded-full bg-purple-400/50"
            style={{
              left: x - 2,
              top: y - 2,
            }}
          />
        );
      })}

      {/* Indicator line */}
      <div
        className="absolute bg-purple-500 rounded-full"
        style={{
          width: 3,
          height: dialRadius - 12,
          left: dialRadius - 1.5,
          top: 6,
          transformOrigin: `center ${dialRadius - 6}px`,
          transform: `rotate(${value}deg)`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
      />

      {/* Center with value */}
      <div
        className="absolute rounded-full bg-purple-500/80 flex items-center justify-center"
        style={{
          width: 28,
          height: 28,
          left: dialRadius - 14,
          top: dialRadius - 14,
        }}
      >
        <span className="text-white text-xs font-bold">{value}°</span>
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
