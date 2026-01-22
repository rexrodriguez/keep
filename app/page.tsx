'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import CapabilityCheck from '@/components/CapabilityCheck';
import RadiusSlider from '@/components/RadiusSlider';
import ResultsDisplay from '@/components/ResultsDisplay';
import { MeasurementData, StorageSearchResponse, StorageSearchRequest } from '@/lib/types';
import { toComputedMeasurements } from '@/lib/measurement/calculations';

// Portrait orientation lock overlay component
function PortraitLockOverlay() {
  return (
    <div className="portrait-lock-overlay">
      <svg
        className="rotate-icon text-white/60"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <p className="text-white/80 text-lg font-medium">Please rotate your device</p>
      <p className="text-white/50 text-sm">This app works best in portrait mode</p>
    </div>
  );
}

// Dynamically import ARSession to avoid SSR issues with Three.js
const ARSession = dynamic(() => import('@/components/ARSession'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

type AppState =
  | 'CHECKING'
  | 'UNSUPPORTED'
  | 'READY'
  | 'AR_ACTIVE'
  | 'RADIUS_SELECT'
  | 'SEARCHING'
  | 'RESULTS';

export default function Home() {
  const [appState, setAppState] = useState<AppState>('CHECKING');
  const [measurementData, setMeasurementData] = useState<MeasurementData | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [searchResults, setSearchResults] = useState<StorageSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Lock screen orientation to portrait using Screen Orientation API
  useEffect(() => {
    const lockOrientation = async () => {
      try {
        // Try to lock orientation (requires fullscreen on some browsers)
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (orientation: string) => Promise<void>;
        };
        if (orientation?.lock) {
          await orientation.lock('portrait');
        }
      } catch {
        // Orientation lock not supported or not allowed - CSS fallback handles this
      }
    };

    lockOrientation();
  }, []);

  const handleSupported = useCallback(() => {
    setAppState('READY');
  }, []);

  const handleUnsupported = useCallback((errorMsg: string) => {
    setError(errorMsg);
    setAppState('UNSUPPORTED');
  }, []);

  const handleStartAR = useCallback(() => {
    setAppState('AR_ACTIVE');
  }, []);

  const handleExitAR = useCallback(() => {
    setAppState('READY');
    setMeasurementData(null);
  }, []);

  const handleFindStorage = useCallback((data: MeasurementData) => {
    setMeasurementData(data);
    setAppState('RADIUS_SELECT');
  }, []);

  const handleBackToAR = useCallback(() => {
    setAppState('AR_ACTIVE');
  }, []);

  const handleSearch = useCallback(async () => {
    if (!measurementData) return;

    setAppState('SEARCHING');

    try {
      // Request geolocation
      let userLocation: { lat: number; lng: number } | null = null;

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });
        userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
      } catch (geoError) {
        console.warn('Geolocation not available:', geoError);
        // Continue without location
      }

      // Prepare request
      const computed = toComputedMeasurements(measurementData);
      const request: StorageSearchRequest = {
        width_cm: computed.width_cm,
        depth_cm: computed.depth_cm,
        height_cm: computed.height_cm,
        volume_m3: computed.volume_m3,
        radius_km: radiusKm,
        user_location: userLocation,
        timestamp: new Date().toISOString(),
      };

      // Call API
      const response = await fetch('/api/storage-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const results: StorageSearchResponse = await response.json();
      setSearchResults(results);
      setAppState('RESULTS');
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to search for storage. Please try again.');
      setAppState('RADIUS_SELECT');
    }
  }, [measurementData, radiusKm]);

  const handleBackToRadius = useCallback(() => {
    setAppState('RADIUS_SELECT');
  }, []);

  const handleNewMeasurement = useCallback(() => {
    setMeasurementData(null);
    setSearchResults(null);
    setAppState('AR_ACTIVE');
  }, []);

  // Render based on app state
  // Portrait lock overlay is always rendered - CSS shows it only in landscape
  const portraitOverlay = <PortraitLockOverlay />;

  if (appState === 'CHECKING') {
    return (
      <>
        {portraitOverlay}
        <CapabilityCheck
          onSupported={handleSupported}
          onUnsupported={handleUnsupported}
        />
      </>
    );
  }

  if (appState === 'UNSUPPORTED') {
    return (
      <>
        {portraitOverlay}
        <CapabilityCheck
          onSupported={handleSupported}
          onUnsupported={handleUnsupported}
        />
      </>
    );
  }

  if (appState === 'READY') {
    return (
      <>
        {portraitOverlay}
        <div className="scrollable-page flex flex-col items-center p-6 bg-gray-900">
        <div className="max-w-md w-full text-center my-auto py-4">
          {/* Logo/Icon */}
          <div className="w-20 h-20 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-12 h-12 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">
            AR Storage Finder
          </h1>
          <p className="text-gray-400 mb-8">
            Measure your items in AR and find the perfect storage unit
          </p>

          {/* Instructions */}
          <div className="bg-gray-800 rounded-xl p-4 mb-8 text-left">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              How it works
            </h2>
            <ol className="space-y-2 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center flex-shrink-0 text-xs">
                  1
                </span>
                Point your camera at the floor until a surface is detected
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center flex-shrink-0 text-xs">
                  2
                </span>
                Tap to place a measurement box on the floor
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center flex-shrink-0 text-xs">
                  3
                </span>
                Aim the reticle at an arrow handle, then drag to resize, rotate, or move the box
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center flex-shrink-0 text-xs">
                  4
                </span>
                Confirm dimensions and find matching storage units nearby
              </li>
            </ol>
          </div>

          {/* Start button */}
          <button
            onClick={handleStartAR}
            className="w-full py-4 rounded-xl font-semibold text-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          >
            Start AR Measurement
          </button>

          {/* Error display */}
          {error && (
            <p className="mt-4 text-red-400 text-sm">{error}</p>
          )}
        </div>
      </div>
      </>
    );
  }

  if (appState === 'AR_ACTIVE') {
    return (
      <>
        {portraitOverlay}
        {/* DOM overlay container for AR UI - pointer-events-auto allows interaction */}
        <div ref={overlayRef} className="fixed inset-0 z-10">
          {/* ARSession renders its own MeasurementUI inside */}
        </div>
        <ARSession
          overlayRef={overlayRef}
          onExit={handleExitAR}
          onFindStorage={handleFindStorage}
        />
      </>
    );
  }

  if (appState === 'RADIUS_SELECT' || appState === 'SEARCHING') {
    return (
      <>
        {portraitOverlay}
        <RadiusSlider
          value={radiusKm}
          onChange={setRadiusKm}
          onSearch={handleSearch}
          onBack={handleBackToAR}
          isSearching={appState === 'SEARCHING'}
        />
      </>
    );
  }

  if (appState === 'RESULTS' && searchResults) {
    return (
      <>
        {portraitOverlay}
        <ResultsDisplay
          results={searchResults}
          onBack={handleBackToRadius}
          onNewMeasurement={handleNewMeasurement}
        />
      </>
    );
  }

  // Fallback
  return (
    <>
      {portraitOverlay}
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </>
  );
}
