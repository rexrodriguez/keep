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
  onSetHeight: (height_m: number) => void;
  onConfirmHeight: () => void;
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
  onSetHeight,
  onConfirmHeight,
  onFindStorage,
  onExit,
}: MeasurementUIProps) {
  const uiState = getUIState(context);
  const isHeightInput = context.state === 'HEIGHT_INPUT';
  const isReview = context.state === 'REVIEW';
  const isDrawing = context.state === 'DRAWING';
  const isReadyToDraw = context.state === 'READY_TO_DRAW';
  const showBottomActions = isHeightInput || isReview;

  // Convert current height to cm for display
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
          {uiState.instruction}
        </p>

        {/* Tracking warning */}
        {trackingWarning && (
          <div className="mt-2 bg-yellow-500/20 border border-yellow-500/40 rounded-lg px-3 py-2">
            <p className="text-yellow-200 text-sm text-center">
              {trackingWarning}
            </p>
          </div>
        )}
      </div>

      {/* Spacer to push bottom content down */}
      <div className="flex-1" />

      {/* Bottom panel - Height slider or Review */}
      {showBottomActions && (
        <div className="pointer-events-auto bg-black/70 backdrop-blur-sm p-4 safe-area-bottom">
          {/* Height slider (compact, at bottom) */}
          {isHeightInput && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white/60 text-sm">Height</span>
                <span className="text-white text-xl font-bold">{heightCm} cm</span>
              </div>

              {/* Height slider */}
              <input
                type="range"
                min="5"
                max="300"
                step="1"
                value={heightCm}
                onChange={(e) => onSetHeight(parseInt(e.target.value) / 100)}
                className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((heightCm - 5) / 295) * 100}%, rgba(255,255,255,0.2) ${((heightCm - 5) / 295) * 100}%, rgba(255,255,255,0.2) 100%)`,
                }}
              />

              {/* Quick height presets */}
              <div className="grid grid-cols-5 gap-2 mt-3">
                {[25, 50, 75, 100, 150].map((h) => (
                  <button
                    key={h}
                    onClick={() => onSetHeight(h / 100)}
                    className={`py-2 rounded text-xs font-medium transition-colors ${
                      heightCm === h
                        ? 'bg-blue-500 text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/20'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
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
                  Redraw
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

      {/* Drawing hint */}
      {(isReadyToDraw || isDrawing) && !trackingWarning && (
        <div className="pointer-events-none pb-8 px-4">
          <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mx-auto w-fit">
            <span className="text-white text-sm font-medium">
              {isDrawing ? 'Drag to size rectangle...' : 'Touch and drag on floor'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
