'use client';

interface RadiusSliderProps {
  value: number;
  onChange: (value: number) => void;
  onSearch: () => void;
  onBack: () => void;
  isSearching: boolean;
}

export default function RadiusSlider({
  value,
  onChange,
  onSearch,
  onBack,
  isSearching,
}: RadiusSliderProps) {
  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col p-6">
      <div className="flex items-center mb-8">
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

      <div className="flex-1 flex flex-col justify-center">
        {/* Current value display */}
        <div className="text-center mb-8">
          <span className="text-6xl font-bold text-white">{value}</span>
          <span className="text-2xl text-white/60 ml-2">km</span>
        </div>

        {/* Slider */}
        <div className="mb-8">
          <input
            type="range"
            min={1}
            max={50}
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value, 10))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
          />
          <div className="flex justify-between text-sm text-white/40 mt-2">
            <span>1 km</span>
            <span>50 km</span>
          </div>
        </div>

        {/* Info text */}
        <p className="text-white/60 text-center text-sm mb-8">
          We'll search for storage facilities within {value} km of your location.
          If location access is denied, we'll show results without distance info.
        </p>
      </div>

      {/* Search button */}
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

      {/* Custom slider styles */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 24px;
          height: 24px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}
