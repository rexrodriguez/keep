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
  aiEnabled: boolean;
  stabilityMode: StabilityMode;
  onUndo: () => void;
  onReset: () => void;
  onSetWidth: (width_m: number) => void;
  onSetDepth: (depth_m: number) => void;
  onSetHeight: (height_m: number) => void;
  onSetRotation: (rotation_deg: number) => void;
  onMoveBox: (deltaX: number, deltaZ: number) => void;
  onConfirmHeight: () => void;
  onCaptureEstimate: () => void;
  onClearTarget: () => void;
  onFindStorage: () => void;
  onSetStabilityMode: (mode: StabilityMode) => void;
  onExit: () => void;
}

export default function MeasurementUI({
  context,
  measurements,
  confidence,
  trackingWarning,
  aiEnabled,
  stabilityMode,
  onUndo,
  onReset,
  onSetWidth,
  onSetDepth,
  onSetHeight,
  onSetRotation,
  onMoveBox,
  onConfirmHeight,
  onCaptureEstimate,
  onClearTarget,
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
  const hasLLMEstimate = context.llmEstimate !== null;

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
          {context.isEstimating ? 'Analyzing image...' : uiState.instruction}
        </p>

        {/* Stability mode toggle - centered below instruction */}
        <div className="flex justify-center mb-2">
          <StabilityModeToggle mode={stabilityMode} onChange={onSetStabilityMode} />
        </div>

        {/* LLM estimate info */}
        {hasLLMEstimate && context.llmEstimate && (
          <div className="mt-2 bg-blue-500/20 border border-blue-500/40 rounded-lg px-3 py-2">
            <p className="text-blue-200 text-sm text-center">
              AI detected: {context.llmEstimate.objectDescription}
            </p>
          </div>
        )}

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
          {/* Dimension rollers (for LLM mode, show all 3) */}
          {isHeightInput && (
            <div className="mb-4 space-y-3">
              {/* Width roller (only show if LLM mode) */}
              {hasLLMEstimate && (
                <DimensionRoller
                  label="Width"
                  value={widthCm}
                  onChange={(cm) => onSetWidth(cm / 100)}
                />
              )}

              {/* Depth roller (only show if LLM mode) */}
              {hasLLMEstimate && (
                <DimensionRoller
                  label="Depth"
                  value={depthCm}
                  onChange={(cm) => onSetDepth(cm / 100)}
                />
              )}

              {/* Height roller */}
              <DimensionRoller
                label="Height"
                value={heightCm}
                onChange={(cm) => onSetHeight(cm / 100)}
              />

              {/* Rotation slider with position controls */}
              <RotationSlider
                value={context.rotation_deg}
                onChange={onSetRotation}
                onMoveBox={onMoveBox}
              />
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
                  {hasLLMEstimate ? 'Redo' : 'Redraw'}
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

      {/* Ready to draw - show options based on whether target is marked and AI is enabled */}
      {isReadyToDraw && !trackingWarning && !context.isEstimating && (
        <div className="pointer-events-auto pb-8 px-4 space-y-3">
          {/* AI mode: show capture button if target marked, or tap instruction */}
          {aiEnabled && context.targetPoint ? (
            <>
              <button
                onClick={onCaptureEstimate}
                className="w-full py-4 px-6 rounded-xl font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-lg flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Capture & Estimate with AI
              </button>
              <button
                onClick={onClearTarget}
                className="w-full py-2 px-4 rounded-lg font-medium bg-white/10 text-white/80 hover:bg-white/20"
              >
                Clear target
              </button>
            </>
          ) : (
            <>
              {/* Show AI tap instruction only if AI is enabled */}
              {aiEnabled && (
                <div className="bg-purple-500/30 backdrop-blur-sm px-4 py-3 rounded-xl mx-auto">
                  <p className="text-white text-sm font-medium text-center">
                    Tap near the object to mark target for AI
                  </p>
                </div>
              )}

              {/* Manual drag hint */}
              <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
                <span className="text-white text-sm font-medium">
                  {aiEnabled ? 'Or touch and drag to draw manually' : 'Touch and drag to draw rectangle'}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Drawing in progress */}
      {isDrawing && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm font-medium">
              Drag to size rectangle...
            </span>
          </div>
        </div>
      )}

      {/* Estimating spinner */}
      {context.isEstimating && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-purple-500/30 backdrop-blur-sm px-6 py-3 rounded-full mx-auto w-fit flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-white text-sm font-medium">
              AI analyzing image...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Horizontal roller component (like a combination lock)
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
          height: isMajor ? '100%' : '70%',
          top: isMajor ? '0' : '15%',
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/60 text-sm">{label}</span>
        <span className="text-white text-xl font-bold">{value} cm</span>
      </div>

      {/* Roller container */}
      <div
        ref={rollerRef}
        className="relative h-12 rounded-lg overflow-hidden cursor-ew-resize select-none touch-none"
        style={{
          background: 'linear-gradient(to bottom, #1a1a1a 0%, #3a3a3a 20%, #4a4a4a 50%, #3a3a3a 80%, #1a1a1a 100%)',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -2px 4px rgba(0,0,0,0.5)',
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
          className="absolute left-1/2 top-0 bottom-0 w-1 bg-blue-500 -translate-x-1/2 z-10"
          style={{
            boxShadow: '0 0 8px rgba(59, 130, 246, 0.8)',
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
  const moveIncrement = 0.05; // 5cm movement per tap

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
