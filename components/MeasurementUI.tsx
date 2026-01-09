'use client';

import { MeasurementState, ComputedMeasurements, ConfidenceLevel } from '@/lib/types';
import { getUIState, StateMachineContext } from '@/lib/measurement/state-machine';

interface MeasurementUIProps {
  context: StateMachineContext;
  measurements: Partial<ComputedMeasurements> | null;
  confidence: ConfidenceLevel | null;
  trackingWarning: string | null;
  onUndo: () => void;
  onReset: () => void;
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
  onFindStorage,
  onExit,
}: MeasurementUIProps) {
  const uiState = getUIState(context);
  const isReview = context.state === 'REVIEW';
  const showActions = ['BASE_P1', 'BASE_P2', 'BASE_P3', 'BASE_P4', 'HEIGHT', 'REVIEW'].includes(
    context.state
  );

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

      {/* Middle - measurements display */}
      {measurements && Object.keys(measurements).length > 0 && (
        <div className="flex-1 flex items-end justify-center pb-4">
          <div className="pointer-events-auto bg-black/60 backdrop-blur-sm rounded-lg p-4 mx-4 max-w-sm w-full">
            {/* Confidence badge */}
            {confidence && (
              <div className="flex justify-center mb-3">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    confidence === 'HIGH'
                      ? 'bg-green-500/20 text-green-300'
                      : confidence === 'MEDIUM'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}
                >
                  {confidence} Confidence
                </span>
              </div>
            )}

            {/* Measurements grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {measurements.width_cm !== undefined && (
                <div>
                  <span className="text-white/60">Width</span>
                  <p className="text-white font-medium">
                    {measurements.width_cm?.toFixed(1)} cm
                  </p>
                  <p className="text-white/60 text-xs">
                    {measurements.width_in?.toFixed(1)}"
                  </p>
                </div>
              )}

              {measurements.depth_cm !== undefined && (
                <div>
                  <span className="text-white/60">Depth</span>
                  <p className="text-white font-medium">
                    {measurements.depth_cm?.toFixed(1)} cm
                  </p>
                  <p className="text-white/60 text-xs">
                    {measurements.depth_in?.toFixed(1)}"
                  </p>
                </div>
              )}

              {measurements.height_cm !== undefined && (
                <div>
                  <span className="text-white/60">Height</span>
                  <p className="text-white font-medium">
                    {measurements.height_cm?.toFixed(1)} cm
                  </p>
                  <p className="text-white/60 text-xs">
                    {measurements.height_in?.toFixed(1)}"
                  </p>
                </div>
              )}

              {measurements.volume_m3 !== undefined && (
                <div>
                  <span className="text-white/60">Volume</span>
                  <p className="text-white font-medium">
                    {measurements.volume_m3?.toFixed(3)} m³
                  </p>
                  <p className="text-white/60 text-xs">
                    {measurements.volume_ft3?.toFixed(2)} ft³
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar - actions */}
      {showActions && (
        <div className="pointer-events-auto bg-black/60 backdrop-blur-sm p-4 safe-area-bottom">
          <div className="flex gap-3">
            {/* Undo button */}
            <button
              onClick={onUndo}
              disabled={!uiState.canUndo}
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                uiState.canUndo
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              Undo
            </button>

            {/* Reset button */}
            <button
              onClick={onReset}
              disabled={!uiState.canReset}
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                uiState.canReset
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              Reset
            </button>

            {/* Find Storage button (only in review) */}
            {isReview && (
              <button
                onClick={onFindStorage}
                className="flex-1 py-3 px-4 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
              >
                Find Storage
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
