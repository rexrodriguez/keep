'use client';

import React from 'react';
import { ComputedMeasurements, ConfidenceLevel } from '@/lib/types';
import { getUIState, StateMachineContext } from '@/lib/measurement/state-machine';
import { StabilityMode } from '@/lib/measurement/stabilization';

interface MeasurementUIProps {
  context: StateMachineContext;
  measurements: ComputedMeasurements | null;
  confidence: ConfidenceLevel | null;
  trackingWarning: string | null;
  stabilityMode: StabilityMode;
  isSegmenting?: boolean;
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
  stabilityMode,
  isSegmenting = false,
  onUndo,
  onReset,
  onSetWidth,
  onSetDepth,
  onSetHeight,
  onSetRotation,
  onMoveBox,
  onConfirmHeight,
  onFindStorage,
  onSetStabilityMode,
  onExit,
}: MeasurementUIProps) {
  const uiState = getUIState(context);
  const isHeightInput = context.state === 'HEIGHT_INPUT';
  const isReview = context.state === 'REVIEW';
  const isDrawing = context.state === 'DRAWING';
  const isReadyToDraw = context.state === 'READY_TO_DRAW';
  const showBottomActions = isHeightInput || isReview;

  // Tab state for switching between Size and Position controls
  const [activeTab, setActiveTab] = React.useState<'size' | 'position'>('size');

  // Convert dimensions to cm for display
  const widthCm = Math.round(context.width_m * 100);
  const depthCm = Math.round(context.depth_m * 100);
  const heightCm = Math.round(context.height_m * 100);

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col">
      {/* Top bar - instruction and step */}
      <div className="pointer-events-auto bg-black/60 backdrop-blur-sm p-4 safe-area-top">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={onExit}
            className="text-white/80 hover:text-white p-2 -ml-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {uiState.currentStep && (
            <span className="text-white/60 text-sm font-medium">
              Step {uiState.currentStep}
            </span>
          )}
        </div>

        <p className="text-white text-lg font-medium text-center mb-3">
          {isSegmenting ? 'Detecting object...' : context.isEstimating ? 'Analyzing image...' : uiState.instruction}
        </p>

        {/* Stability mode toggle - centered below instruction */}
        <div className="flex justify-center mb-2">
          <StabilityModeToggle mode={stabilityMode} onChange={onSetStabilityMode} />
        </div>

        {/* Tracking warning */}
        {trackingWarning && !context.isEstimating && (
          <div className="mt-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-3 py-2">
            <p className="text-yellow-200 text-sm text-center">
              {trackingWarning}
            </p>
          </div>
        )}

        {/* Error message */}
        {context.error && (
          <div className="mt-2 bg-red-500/20 border border-red-500/40 rounded-lg px-3 py-2">
            <p className="text-red-200 text-sm text-center">
              {context.error}
            </p>
          </div>
        )}
      </div>

      {/* Spacer to push bottom content down */}
      <div className="flex-1" />

      {/* Bottom panel - Dimension sliders or Review */}
      {showBottomActions && (
        <div className="pointer-events-auto bg-black/70 backdrop-blur-sm p-4 safe-area-bottom">
          {/* Tab controls */}
          {isHeightInput && (
            <div className="mb-3">
              {/* Tab buttons */}
              <div className="flex mb-3 bg-white/10 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('size')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    activeTab === 'size'
                      ? 'bg-blue-500 text-white'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Size
                </button>
                <button
                  onClick={() => setActiveTab('position')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                    activeTab === 'position'
                      ? 'bg-blue-500 text-white'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Position
                </button>
              </div>

              {/* Size tab content */}
              {activeTab === 'size' && (
                <div className="space-y-2">
                  <DimensionRoller
                    label="W"
                    value={widthCm}
                    onChange={(cm) => onSetWidth(cm / 100)}
                  />
                  <DimensionRoller
                    label="D"
                    value={depthCm}
                    onChange={(cm) => onSetDepth(cm / 100)}
                  />
                  <DimensionRoller
                    label="H"
                    value={heightCm}
                    onChange={(cm) => onSetHeight(cm / 100)}
                  />
                </div>
              )}

              {/* Position tab content */}
              {activeTab === 'position' && (
                <RotationSlider
                  value={context.rotation_deg}
                  onChange={onSetRotation}
                  onMoveBox={onMoveBox}
                />
              )}
            </div>
          )}

          {/* Measurements summary (compact) */}
          {measurements && (
            <div className="mb-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div className="flex-1 text-center">
                  <span className="text-white/60 block text-xs">W</span>
                  <span className="text-white font-medium">{measurements.width_cm.toFixed(0)}cm</span>
                </div>
                <div className="flex-1 text-center">
                  <span className="text-white/60 block text-xs">D</span>
                  <span className="text-white font-medium">{measurements.depth_cm.toFixed(0)}cm</span>
                </div>
                <div className="flex-1 text-center">
                  <span className="text-white/60 block text-xs">H</span>
                  <span className="text-white font-medium">{measurements.height_cm.toFixed(0)}cm</span>
                </div>
                <div className="flex-1 text-center">
                  <span className="text-white/60 block text-xs">Vol</span>
                  <span className="text-white font-medium">{measurements.volume_m3.toFixed(2)}m³</span>
                </div>
                {confidence && (
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      confidence === 'HIGH'
                        ? 'bg-green-500/20 text-green-300'
                        : confidence === 'MEDIUM'
                        ? 'bg-yellow-500/20 text-yellow-300'
                        : 'bg-red-500/20 text-red-300'
                    }`}
                  >
                    {confidence}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {isHeightInput && (
              <>
                <button
                  onClick={onUndo}
                  className="flex-1 py-3 px-4 rounded-lg font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  Redo
                </button>
                <button
                  onClick={onConfirmHeight}
                  className="flex-1 py-3 px-4 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  Confirm
                </button>
              </>
            )}

            {isReview && (
              <>
                <button
                  onClick={onReset}
                  className="flex-1 py-3 px-4 rounded-lg font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  Redo
                </button>
                <button
                  onClick={onFindStorage}
                  className="flex-1 py-3 px-4 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  Find Storage
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Ready to place - simple tap instruction */}
      {isReadyToDraw && !trackingWarning && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm font-medium">
              Tap to place a box
            </span>
          </div>
        </div>
      )}

      {/* Drawing/resizing in progress */}
      {isDrawing && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm font-medium">
              Drag to resize...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact horizontal roller component (like a combination lock)
function DimensionRoller({
  label,
  value,
  onChange,
  min = 1,
  max = 500,
}: {
  label: string;
  value: number;
  onChange: (cm: number) => void;
  min?: number;
  max?: number;
}) {
  const rollerRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const lastXRef = React.useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    lastXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;

    const deltaX = e.clientX - lastXRef.current;
    // Each 3px of drag = 1cm change
    const deltaCm = Math.round(deltaX / 3);

    if (deltaCm !== 0) {
      const newValue = Math.max(min, Math.min(max, value + deltaCm));
      onChange(newValue);
      lastXRef.current = e.clientX;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Generate tick marks for the roller
  const tickCount = 40;
  const ticks = [];
  for (let i = 0; i < tickCount; i++) {
    // Create illusion of rotation based on value
    const offset = (value * 2 + i * 8) % (tickCount * 8);
    const normalizedPos = (offset / (tickCount * 8)) * 100;
    const isMajor = i % 5 === 0;

    ticks.push(
      <div
        key={i}
        className={`absolute top-0 bottom-0 ${isMajor ? 'bg-white/60 w-0.5' : 'bg-white/30 w-px'}`}
        style={{
          left: `${normalizedPos}%`,
          height: isMajor ? '100%' : '60%',
          top: isMajor ? '0' : '20%',
        }}
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Label */}
      <span className="text-white/60 text-sm w-6">{label}</span>

      {/* Roller container */}
      <div
        ref={rollerRef}
        className="relative flex-1 h-8 rounded overflow-hidden cursor-ew-resize select-none touch-none"
        style={{
          background: 'linear-gradient(to bottom, #1a1a1a 0%, #3a3a3a 20%, #4a4a4a 50%, #3a3a3a 80%, #1a1a1a 100%)',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5), inset 0 -1px 3px rgba(0,0,0,0.5)',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Tick marks */}
        <div className="absolute inset-0">
          {ticks}
        </div>

        {/* Center indicator line */}
        <div
          className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-blue-500 -translate-x-1/2 z-10"
          style={{
            boxShadow: '0 0 6px rgba(59, 130, 246, 0.8)',
          }}
        />

        {/* Highlight gradient overlay for 3D effect */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.2) 100%)',
          }}
        />
      </div>

      {/* Value display */}
      <span className="text-white font-bold w-16 text-right">{value} cm</span>
    </div>
  );
}

// Rotation roller component (circular dial) with position controls
function RotationSlider({
  value,
  onChange,
  onMoveBox,
}: {
  value: number;
  onChange: (deg: number) => void;
  onMoveBox: (deltaX: number, deltaZ: number) => void;
}) {
  const rollerRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!rollerRef.current) return;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateRotationFromPointer(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateRotationFromPointer(e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const updateRotationFromPointer = (e: React.PointerEvent) => {
    if (!rollerRef.current) return;
    const rect = rollerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;

    // Calculate angle in degrees (0° = up, clockwise)
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    onChange(Math.round(angle));
  };

  const dialRadius = 60; // Radius of the dial
  const moveIncrement = 0.025; // 2.5cm movement per tap

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/60 text-sm">Rotation & Position</span>
        <span className="text-white text-lg font-bold">{value}°</span>
      </div>

      <div className="flex items-center gap-4">
        {/* Circular roller dial */}
        <div
          ref={rollerRef}
          className="relative shrink-0 cursor-pointer select-none touch-none"
          style={{ width: dialRadius * 2, height: dialRadius * 2 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full bg-white/10 border-2 border-white/20" />

          {/* Degree markers every 45° */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg - 90) * (Math.PI / 180);
            const x = dialRadius + Math.cos(rad) * (dialRadius - 12);
            const y = dialRadius + Math.sin(rad) * (dialRadius - 12);
            return (
              <div
                key={deg}
                className="absolute w-1.5 h-1.5 rounded-full bg-white/40"
                style={{
                  left: x - 3,
                  top: y - 3,
                }}
              />
            );
          })}

          {/* Indicator line */}
          <div
            className="absolute bg-purple-500 rounded-full"
            style={{
              width: 4,
              height: dialRadius - 16,
              left: dialRadius - 2,
              top: 8,
              transformOrigin: `center ${dialRadius - 8}px`,
              transform: `rotate(${value}deg)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
          />

          {/* Center knob */}
          <div
            className="absolute rounded-full bg-purple-500 shadow-lg"
            style={{
              width: 20,
              height: 20,
              left: dialRadius - 10,
              top: dialRadius - 10,
            }}
          />
        </div>

        {/* Directional arrows for position control */}
        <div className="flex-1 grid grid-cols-3 grid-rows-3 gap-1">
          {/* Top row */}
          <div />
          <button
            onClick={() => onMoveBox(0, -moveIncrement)}
            className="bg-white/10 hover:bg-white/20 active:bg-white/30 rounded p-2 transition-colors"
          >
            <svg className="w-5 h-5 text-white mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <div />

          {/* Middle row */}
          <button
            onClick={() => onMoveBox(-moveIncrement, 0)}
            className="bg-white/10 hover:bg-white/20 active:bg-white/30 rounded p-2 transition-colors"
          >
            <svg className="w-5 h-5 text-white mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-white/40" />
          </div>
          <button
            onClick={() => onMoveBox(moveIncrement, 0)}
            className="bg-white/10 hover:bg-white/20 active:bg-white/30 rounded p-2 transition-colors"
          >
            <svg className="w-5 h-5 text-white mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Bottom row */}
          <div />
          <button
            onClick={() => onMoveBox(0, moveIncrement)}
            className="bg-white/10 hover:bg-white/20 active:bg-white/30 rounded p-2 transition-colors"
          >
            <svg className="w-5 h-5 text-white mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div />
        </div>
      </div>

      <div className="text-center mt-1">
        <span className="text-white/40 text-xs">Arrows move box by 5cm</span>
      </div>
    </div>
  );
}

// Stability mode toggle component
function StabilityModeToggle({
  mode,
  onChange,
}: {
  mode: StabilityMode;
  onChange: (mode: StabilityMode) => void;
}) {
  const modes: { value: StabilityMode; icon: string; label: string; color: string }[] = [
    { value: 'strict', icon: '🎯', label: 'Precise', color: 'bg-blue-500' },
    { value: 'balanced', icon: '⚖️', label: 'Balanced', color: 'bg-green-500' },
    { value: 'relaxed', icon: '⚡', label: 'Fast', color: 'bg-orange-500' },
  ];

  const currentMode = modes.find((m) => m.value === mode) || modes[1];

  return (
    <div className="relative group">
      <button
        className={`${currentMode.color} text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 hover:opacity-90 transition-opacity`}
        title="Tracking Mode"
      >
        <span>{currentMode.icon}</span>
        <span className="hidden sm:inline">{currentMode.label}</span>
      </button>

      {/* Dropdown menu */}
      <div className="absolute top-full right-0 mt-1 bg-black/90 backdrop-blur-sm rounded-lg shadow-lg overflow-hidden opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-white/10 transition-colors ${
              mode === m.value ? 'bg-white/5 text-white font-medium' : 'text-white/80'
            }`}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
        <div className="px-4 py-2 text-xs text-white/50 border-t border-white/10">
          <div className="space-y-1">
            <div><span className="font-semibold">🎯 Precise:</span> Most stable</div>
            <div><span className="font-semibold">⚖️ Balanced:</span> Recommended</div>
            <div><span className="font-semibold">⚡ Fast:</span> Most responsive</div>
          </div>
        </div>
      </div>
    </div>
  );
}
