'use client';

import { ComputedMeasurements, ConfidenceLevel } from '@/lib/types';
import { getUIState, StateMachineContext } from '@/lib/measurement/state-machine';

interface MeasurementUIProps {
  context: StateMachineContext;
  measurements: ComputedMeasurements | null;
  confidence: ConfidenceLevel | null;
  trackingWarning: string | null;
  onUndo: () => void;
  onReset: () => void;
  onSetWidth: (width_m: number) => void;
  onSetDepth: (depth_m: number) => void;
  onSetHeight: (height_m: number) => void;
  onConfirmHeight: () => void;
  onCaptureEstimate: () => void;
  onClearTarget: () => void;
  onFindStorage: () => void;
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
  onConfirmHeight,
  onCaptureEstimate,
  onClearTarget,
  onFindStorage,
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

        <p className="text-white text-lg font-medium text-center">
          {context.isEstimating ? 'Analyzing image...' : uiState.instruction}
        </p>

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
          {/* Dimension sliders (for LLM mode, show all 3) */}
          {isHeightInput && (
            <div className="mb-4 space-y-3">
              {/* Width slider (only show if LLM mode) */}
              {hasLLMEstimate && (
                <DimensionSlider
                  label="Width"
                  value={widthCm}
                  onChange={(cm) => onSetWidth(cm / 100)}
                  presets={[30, 50, 75, 100, 150]}
                />
              )}

              {/* Depth slider (only show if LLM mode) */}
              {hasLLMEstimate && (
                <DimensionSlider
                  label="Depth"
                  value={depthCm}
                  onChange={(cm) => onSetDepth(cm / 100)}
                  presets={[30, 50, 75, 100, 150]}
                />
              )}

              {/* Height slider */}
              <DimensionSlider
                label="Height"
                value={heightCm}
                onChange={(cm) => onSetHeight(cm / 100)}
                presets={[25, 50, 75, 100, 150]}
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

      {/* Ready to draw - show options based on whether target is marked */}
      {isReadyToDraw && !trackingWarning && !context.isEstimating && (
        <div className="pointer-events-auto pb-8 px-4 space-y-3">
          {/* If target is marked, show capture button */}
          {context.targetPoint ? (
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
              {/* No target - show instructions */}
              <div className="bg-purple-500/30 backdrop-blur-sm px-4 py-3 rounded-xl mx-auto">
                <p className="text-white text-sm font-medium text-center">
                  Tap near the object to mark target for AI
                </p>
              </div>

              {/* Manual drag hint */}
              <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
                <span className="text-white text-sm font-medium">
                  Or touch and drag to draw manually
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

// Dimension slider component
function DimensionSlider({
  label,
  value,
  onChange,
  presets,
}: {
  label: string;
  value: number;
  onChange: (cm: number) => void;
  presets: number[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-white/60 text-sm">{label}</span>
        <span className="text-white text-lg font-bold">{value} cm</span>
      </div>

      <input
        type="range"
        min="5"
        max="300"
        step="1"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((value - 5) / 295) * 100}%, rgba(255,255,255,0.2) ${((value - 5) / 295) * 100}%, rgba(255,255,255,0.2) 100%)`,
        }}
      />

      <div className="grid grid-cols-5 gap-2 mt-2">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`py-1.5 rounded text-xs font-medium transition-colors ${
              value === p
                ? 'bg-blue-500 text-white'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
