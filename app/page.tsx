'use client';

import { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import LandingPage from '@/components/LandingPage';
import CapabilityCheck from '@/components/CapabilityCheck';
import RadiusSlider from '@/components/RadiusSlider';
import ResultsDisplay from '@/components/ResultsDisplay';
import ItemListView from '@/components/ItemListView';
import { MeasuredItem, StorageSearchResponse, StorageSearchRequest } from '@/lib/types';
import { totalVolume } from '@/lib/measurement/calculations';

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
  | 'LANDING'
  | 'CHECKING'
  | 'UNSUPPORTED'
  | 'READY'
  | 'AR_ACTIVE'
  | 'ITEM_LIST'
  | 'RADIUS_SELECT'
  | 'SEARCHING'
  | 'RESULTS';


export default function Home() {
  const [appState, setAppState] = useState<AppState>('LANDING');
  const [measuredItems, setMeasuredItems] = useState<MeasuredItem[]>([]);
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [searchResults, setSearchResults] = useState<StorageSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tutorialEnabled, setTutorialEnabled] = useState(true);

  const overlayRef = useRef<HTMLDivElement>(null);


  const handleGetStarted = useCallback(() => {
    setAppState('CHECKING');
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
    setMeasuredItems([]);
  }, []);

  const handleAddItem = useCallback((item: MeasuredItem) => {
    setMeasuredItems(prev => [...prev, item]);
  }, []);

  const handleDone = useCallback(() => {
    setAppState('ITEM_LIST');
  }, []);

  const handleDeleteItem = useCallback((id: string) => {
    setMeasuredItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const handleAddMore = useCallback(() => {
    setAppState('AR_ACTIVE');
  }, []);

  const handleSearch = useCallback(async () => {
    if (measuredItems.length === 0) return;

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

      // Use the largest item's dimensions for the API request
      const largest = measuredItems.reduce((a, b) =>
        a.width_m * a.depth_m * a.height_m > b.width_m * b.depth_m * b.height_m ? a : b
      );
      const request: StorageSearchRequest = {
        width_cm: largest.width_m * 100,
        depth_cm: largest.depth_m * 100,
        height_cm: largest.height_m * 100,
        volume_m3: totalVolume(measuredItems),
        radius_km: radiusMiles * 1.60934,
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
  }, [measuredItems, radiusMiles]);

  const handleBackToRadius = useCallback(() => {
    setAppState('RADIUS_SELECT');
  }, []);

  const handleNewMeasurement = useCallback(() => {
    setSearchResults(null);
    setAppState('ITEM_LIST');
  }, []);

  // Render based on app state
  if (appState === 'LANDING') {
    return <LandingPage onGetStarted={handleGetStarted} />;
  }

  if (appState === 'CHECKING') {
    return (
      <CapabilityCheck
        onSupported={handleSupported}
        onUnsupported={handleUnsupported}
      />
    );
  }

  if (appState === 'UNSUPPORTED') {
    return (
      <CapabilityCheck
        onSupported={handleSupported}
        onUnsupported={handleUnsupported}
      />
    );
  }

  if (appState === 'READY') {
    return (
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

          {/* Tutorial toggle */}
          <label className="flex items-center justify-center gap-3 mb-6 cursor-pointer">
            <input
              type="checkbox"
              checked={tutorialEnabled}
              onChange={(e) => setTutorialEnabled(e.target.checked)}
              className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
            />
            <span className="text-gray-300 text-sm">Show tutorial walkthrough</span>
          </label>

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
    );
  }

  if (appState === 'AR_ACTIVE') {
    return (
      <>
        {/* DOM overlay container for AR UI - pointer-events-auto allows interaction */}
        <div ref={overlayRef} className="fixed inset-0 z-10">
          {/* ARSession renders its own MeasurementUI inside */}
        </div>
        <ARSession
          overlayRef={overlayRef}
          onExit={handleExitAR}
          onAddItem={handleAddItem}
          onDone={handleDone}
          itemCount={measuredItems.length}
          tutorialEnabled={tutorialEnabled}
        />
      </>
    );
  }

  if (appState === 'ITEM_LIST') {
    return (
      <ItemListView
        items={measuredItems}
        onDelete={handleDeleteItem}
        onAddMore={handleAddMore}
        onFindStorage={() => setAppState('RADIUS_SELECT')}
      />
    );
  }

  if (appState === 'RADIUS_SELECT' || appState === 'SEARCHING') {
    return (
      <RadiusSlider
        value={radiusMiles}
        onChange={setRadiusMiles}
        onSearch={handleSearch}
        onBack={() => setAppState('ITEM_LIST')}
        isSearching={appState === 'SEARCHING'}
        items={measuredItems}
      />
    );
  }

  if (appState === 'RESULTS' && searchResults) {
    return (
      <ResultsDisplay
        results={searchResults}
        onBack={handleBackToRadius}
        onNewMeasurement={handleNewMeasurement}
        items={measuredItems}
      />
    );
  }

  // Fallback
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
