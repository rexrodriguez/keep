'use client';

import { StorageSearchResponse, StorageFacility, StorageUnit } from '@/lib/types';

interface ResultsDisplayProps {
  results: StorageSearchResponse;
  onBack: () => void;
  onNewMeasurement: () => void;
}

export default function ResultsDisplay({
  results,
  onBack,
  onNewMeasurement,
}: ResultsDisplayProps) {
  const { facilities, object_dimensions } = results;

  return (
    <div className="scrollable-page bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 p-4 z-10">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            className="text-white/80 hover:text-white p-2 -ml-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">Storage Results</h1>
          <div className="w-10" /> {/* Spacer for centering */}
        </div>

        {/* Object dimensions summary */}
        <div className="bg-gray-800 rounded-lg p-3 text-sm">
          <span className="text-gray-400">Your object: </span>
          <span className="text-white">
            {object_dimensions.width_cm.toFixed(0)} × {object_dimensions.depth_cm.toFixed(0)} × {object_dimensions.height_cm.toFixed(0)} cm
          </span>
          <span className="text-gray-400 ml-2">
            ({object_dimensions.volume_m3.toFixed(2)} m³)
          </span>
        </div>
      </div>

      {/* Scrollable results list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {facilities.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-400">No storage facilities found</h3>
            <p className="text-sm text-gray-500 mt-1">Try increasing your search radius</p>
          </div>
        ) : (
          facilities.map((facility) => (
            <FacilityCard
              key={facility.id}
              facility={facility}
              objectDimensions={object_dimensions}
            />
          ))
        )}
      </div>

      {/* Bottom action - sticky instead of fixed for proper scrolling */}
      <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-800 p-4">
        <button
          onClick={onNewMeasurement}
          className="w-full py-3 rounded-lg font-medium bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          New Measurement
        </button>
      </div>
    </div>
  );
}

interface FacilityCardProps {
  facility: StorageFacility;
  objectDimensions: {
    width_cm: number;
    depth_cm: number;
    height_cm: number;
    volume_m3: number;
  };
}

function FacilityCard({ facility, objectDimensions }: FacilityCardProps) {
  // Find fitting units
  const fittingUnits = facility.units.filter((unit) =>
    unitFits(unit, objectDimensions)
  );
  const cheapestFitting = fittingUnits.length > 0
    ? fittingUnits.reduce((min, unit) =>
        unit.price_monthly < min.price_monthly ? unit : min
      )
    : null;

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Facility header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-white">{facility.name}</h3>
            <p className="text-sm text-gray-400 mt-0.5">{facility.address}</p>
          </div>
          {facility.distance_km !== null && (
            <span className="text-sm text-gray-400 whitespace-nowrap ml-4">
              {facility.distance_km.toFixed(1)} km
            </span>
          )}
        </div>

        {/* Rating */}
        <div className="flex items-center gap-1 mt-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <svg
              key={star}
              className={`w-4 h-4 ${
                star <= facility.rating ? 'text-yellow-400' : 'text-gray-600'
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          ))}
          <span className="text-sm text-gray-400 ml-1">
            {facility.rating.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Units */}
      <div className="p-4">
        <h4 className="text-sm font-medium text-gray-400 mb-3">Available Units</h4>
        <div className="space-y-2">
          {facility.units.map((unit) => {
            const fits = unitFits(unit, objectDimensions);
            const isCheapest = cheapestFitting?.id === unit.id;

            return (
              <div
                key={unit.id}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  fits ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-700/50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{unit.name}</span>
                    {fits && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-300 rounded">
                        FITS
                      </span>
                    )}
                    {isCheapest && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-300 rounded">
                        BEST VALUE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {unit.width_cm} × {unit.depth_cm} × {unit.height_cm} cm
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-white">
                    ${unit.price_monthly}/mo
                  </p>
                  <p className={`text-xs ${unit.available ? 'text-green-400' : 'text-red-400'}`}>
                    {unit.available ? 'Available' : 'Unavailable'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Check if a unit fits the object
 * Direct fit OR volume fit with 1.25x padding
 */
function unitFits(
  unit: StorageUnit,
  obj: { width_cm: number; depth_cm: number; height_cm: number; volume_m3: number }
): boolean {
  // Direct dimension fit
  const directFit =
    unit.width_cm >= obj.width_cm &&
    unit.depth_cm >= obj.depth_cm &&
    unit.height_cm >= obj.height_cm;

  // Volume fit with 1.25x padding factor
  const volumeFit = unit.volume_m3 >= obj.volume_m3 * 1.25;

  return directFit || volumeFit;
}
