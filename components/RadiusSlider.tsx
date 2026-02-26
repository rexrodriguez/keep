'use client';

import { MeasuredItem } from '@/lib/types';

interface RadiusSliderProps {
  value: number;
  onChange: (value: number) => void;
  onSearch: () => void;
  onBack: () => void;
  isSearching: boolean;
  items?: MeasuredItem[];
}

export default function RadiusSlider({
  value,
  onChange,
  onSearch,
  onBack,
  isSearching,
  items,
}: RadiusSliderProps) {
  const totalVol = items ? items.reduce((s, i) => s + i.width_m * i.depth_m * i.height_m, 0) * 35.3147 : 0;

  return (
    <div className="scrollable-page bg-gray-900 flex flex-col">
      {/* Fixed header */}
      <div className="sticky top-0 bg-gray-900 z-10 p-4 pb-2">
        <div className="flex items-center">
          <button
            onClick={onBack}
            className="text-white/80 hover:text-white p-2 -ml-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-white ml-2">Search Radius</h1>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-md mx-auto">
          {items && items.length > 0 && (
            <div className="bg-white/5 rounded-xl p-3 mb-4">
              <div className="text-white/60 text-xs mb-1">Measuring for</div>
              <div className="text-white font-medium">
                {items.length} item{items.length !== 1 ? 's' : ''} — {totalVol.toFixed(1)} cu ft
              </div>
            </div>
          )}

          {/* Current value display */}
          <div className="text-center mb-6">
            <span className="text-5xl font-bold text-white">{value}</span>
            <span className="text-xl text-white/60 ml-2">{value === 1 ? 'mile' : 'miles'}</span>
          </div>

          {/* Slider */}
          <div className="mb-6">
            <input
              type="range"
              min={1}
              max={30}
              value={value}
              onChange={(e) => onChange(parseInt(e.target.value, 10))}
              className="w-full h-3 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              style={{ touchAction: 'none' }}
            />
            <div className="flex justify-between text-sm text-white/40 mt-2">
              <span>1 mile</span>
              <span>30 miles</span>
            </div>
          </div>

          {/* Info text */}
          <p className="text-white/60 text-center text-sm">
            We&apos;ll search for storage facilities within {value} {value === 1 ? 'mile' : 'miles'} of your location.
            If location access is denied, we&apos;ll show results without distance info.
          </p>
        </div>
      </div>

      {/* Fixed bottom button */}
      <div className="sticky bottom-0 bg-gray-900 p-4 pt-2">
        <div className="max-w-md mx-auto">
          <button
            onClick={onSearch}
            disabled={isSearching}
            className={`w-full py-4 rounded-lg font-semibold text-lg transition-colors ${
              isSearching
                ? 'bg-blue-500/50 text-white/50 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isSearching ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Searching...
              </span>
            ) : (
              'Find Storage'
            )}
          </button>
        </div>
      </div>

      {/* Custom slider styles */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 32px;
          height: 32px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 32px;
          height: 32px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}
