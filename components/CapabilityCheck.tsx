'use client';

import { useEffect, useState } from 'react';
import {
  checkWebXRCapabilities,
  getCheckStatus,
  getTroubleshootingSteps,
} from '@/lib/webxr/capability-check';
import { CapabilityResult } from '@/lib/types';

interface CapabilityCheckProps {
  onSupported: () => void;
  onUnsupported: (error: string) => void;
}

export default function CapabilityCheck({
  onSupported,
  onUnsupported,
}: CapabilityCheckProps) {
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<CapabilityResult | null>(null);

  useEffect(() => {
    async function runChecks() {
      setChecking(true);
      const checkResult = await checkWebXRCapabilities();
      setResult(checkResult);
      setChecking(false);

      if (checkResult.supported) {
        onSupported();
      } else {
        onUnsupported(checkResult.errorMessage || 'Device not supported');
      }
    }

    runChecks();
  }, [onSupported, onUnsupported]);

  if (checking) {
    return (
      <div className="scrollable-page flex flex-col items-center p-6 bg-gray-900 text-white">
        <div className="my-auto py-4 flex flex-col items-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-semibold mb-2">Checking Device Capabilities</h2>
        <p className="text-gray-400 text-center">
          Verifying AR support on your device...
        </p>
        </div>
      </div>
    );
  }

  if (!result) return null;

  if (result.supported) {
    return (
      <div className="scrollable-page flex flex-col items-center p-6 bg-gray-900 text-white">
        <div className="my-auto py-4 flex flex-col items-center">
        <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Device Supported</h2>
        <p className="text-gray-400 text-center">
          Your device supports AR measurement
        </p>
        </div>
      </div>
    );
  }

  // Unsupported device UI
  const checkStatuses = getCheckStatus(result.checks);
  const troubleshootingSteps = getTroubleshootingSteps();

  return (
    <div className="scrollable-page flex flex-col p-6 bg-gray-900 text-white">
      <div className="flex-1 flex flex-col items-center max-w-md mx-auto py-4">
        {/* Error icon */}
        <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mb-4">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold mb-2 text-center">
          AR Measurement Not Supported
        </h2>
        <p className="text-gray-400 text-center mb-6">
          {result.errorMessage}
        </p>

        {/* Capability checks */}
        <div className="w-full bg-gray-800 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">
            Capability Checks
          </h3>
          <ul className="space-y-2">
            {checkStatuses.map((check) => (
              <li key={check.name} className="flex items-center gap-3">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    check.passed ? 'bg-green-500' : 'bg-red-500'
                  }`}
                >
                  {check.passed ? (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </span>
                <div>
                  <span className="text-sm font-medium">{check.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {check.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Troubleshooting */}
        <div className="w-full bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">
            Troubleshooting
          </h3>
          <ul className="space-y-2">
            {troubleshootingSteps.map((step, index) => (
              <li key={index} className="flex items-start gap-3 text-sm text-gray-400">
                <span className="text-blue-400 font-medium">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
