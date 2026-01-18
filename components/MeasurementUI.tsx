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

  // Convert dimensions to cm for display
  const widthCm = Math.round(context.width_m * 100);
  const depthCm = Math.round(context.depth_m * 100);
  const heightCm = Math.round(context.height_m * 100);

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col">
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
                <span>{measurements.width_cm.toFixed(0)}</span>
                <span className="text-white/40">×</span>
                <span>{measurements.depth_cm.toFixed(0)}</span>
                <span className="text-white/40">×</span>
                <span>{measurements.height_cm.toFixed(0)}</span>
                <span className="text-white/40 text-xs">cm</span>
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
      <div className="flex-1" />

      {/* Bottom panel - Adjustment controls */}
      {showBottomPanel && (
        <div className="pointer-events-auto bg-black/80 backdrop-blur-md rounded-t-2xl safe-area-bottom">
          {isHeightInput && (
            <AdjustmentPanel
              widthCm={widthCm}
              depthCm={depthCm}
              heightCm={heightCm}
              rotationDeg={context.rotation_deg}
              onSetWidth={(cm) => onSetWidth(cm / 100)}
              onSetDepth={(cm) => onSetDepth(cm / 100)}
              onSetHeight={(cm) => onSetHeight(cm / 100)}
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
  widthCm,
  depthCm,
  heightCm,
  rotationDeg,
  onSetWidth,
  onSetDepth,
  onSetHeight,
  onSetRotation,
  onMoveBox,
  onUndo,
  onConfirm,
}: {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  rotationDeg: number;
  onSetWidth: (cm: number) => void;
  onSetDepth: (cm: number) => void;
  onSetHeight: (cm: number) => void;
  onSetRotation: (deg: number) => void;
  onMoveBox: (deltaX: number, deltaZ: number) => void;
  onUndo: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="p-4">
      {/* Dimension inputs - simple stepper style */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <DimensionStepper
          label="Width"
          value={widthCm}
          onChange={onSetWidth}
          color="blue"
        />
        <DimensionStepper
          label="Depth"
          value={depthCm}
          onChange={onSetDepth}
          color="green"
        />
        <DimensionStepper
          label="Height"
          value={heightCm}
          onChange={onSetHeight}
          color="purple"
        />
      </div>

      {/* Position controls - joystick and rotation */}
      <div className="flex items-center justify-center gap-6 mb-4">
        <div className="text-center">
          <Joystick onMove={onMoveBox} />
          <span className="text-white/50 text-xs mt-1 block">Move</span>
        </div>
        <div className="text-center">
          <RotationDial value={rotationDeg} onChange={onSetRotation} />
          <span className="text-white/50 text-xs mt-1 block">Rotate</span>
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
// Dimension Stepper - Tap to adjust with +/- buttons and direct input
// ============================================================================

function DimensionStepper({
  label,
  value,
  onChange,
  color,
  min = 1,
  max = 500,
}: {
  label: string;
  value: number;
  onChange: (cm: number) => void;
  color: 'blue' | 'green' | 'purple';
  min?: number;
  max?: number;
}) {
  const colorClasses = {
    blue: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
    green: 'bg-green-500/20 border-green-500/30 text-green-400',
    purple: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
  };

  const buttonColorClasses = {
    blue: 'active:bg-blue-500/30',
    green: 'active:bg-green-500/30',
    purple: 'active:bg-purple-500/30',
  };

  // Long-press for continuous adjustment
  const intervalRef = React.useRef<number | null>(null);
  const timeoutRef = React.useRef<number | null>(null);
  const localValueRef = React.useRef(value);

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
  };

  const handleStartMinus = () => {
    // Immediate adjustment
    const newVal = Math.max(min, localValueRef.current - 1);
    localValueRef.current = newVal;
    onChange(newVal);

    // Continuous adjustment after delay
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        const nextVal = Math.max(min, localValueRef.current - 1);
        localValueRef.current = nextVal;
        onChange(nextVal);
      }, 50);
    }, 300);
  };

  const handleStartPlus = () => {
    // Immediate adjustment
    const newVal = Math.min(max, localValueRef.current + 1);
    localValueRef.current = newVal;
    onChange(newVal);

    // Continuous adjustment after delay
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        const nextVal = Math.min(max, localValueRef.current + 1);
        localValueRef.current = nextVal;
        onChange(nextVal);
      }, 50);
    }, 300);
  };

  React.useEffect(() => {
    return () => {
      stopAdjusting();
    };
  }, []);

  return (
    <div className={`rounded-xl border ${colorClasses[color]} p-2`}>
      <div className="text-xs text-center mb-1 opacity-70">{label}</div>
      <div className="flex items-center justify-between gap-1">
        <button
          onPointerDown={handleStartMinus}
          onPointerUp={stopAdjusting}
          onPointerLeave={stopAdjusting}
          onPointerCancel={stopAdjusting}
          className={`w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-lg font-bold ${buttonColorClasses[color]} select-none touch-none`}
        >
          −
        </button>
        <div className="flex-1 text-center">
          <span className="text-white text-lg font-bold">{value}</span>
          <span className="text-white/50 text-xs ml-0.5">cm</span>
        </div>
        <button
          onPointerDown={handleStartPlus}
          onPointerUp={stopAdjusting}
          onPointerLeave={stopAdjusting}
          onPointerCancel={stopAdjusting}
          className={`w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-lg font-bold ${buttonColorClasses[color]} select-none touch-none`}
        >
          +
        </button>
      </div>
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
      const speed = 0.015; // meters per tick

      onMoveRef.current(normalizedX * speed, normalizedY * speed);
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
            <div className="text-white text-xl font-bold">{measurements.width_cm.toFixed(0)}</div>
            <div className="text-white/50 text-xs">Width cm</div>
          </div>
          <div>
            <div className="text-white text-xl font-bold">{measurements.depth_cm.toFixed(0)}</div>
            <div className="text-white/50 text-xs">Depth cm</div>
          </div>
          <div>
            <div className="text-white text-xl font-bold">{measurements.height_cm.toFixed(0)}</div>
            <div className="text-white/50 text-xs">Height cm</div>
          </div>
          <div>
            <div className="text-white text-xl font-bold">{measurements.volume_m3.toFixed(2)}</div>
            <div className="text-white/50 text-xs">Vol m³</div>
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
