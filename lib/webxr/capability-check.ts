import { CapabilityResult, CapabilityChecks } from '@/lib/types';

/**
 * Comprehensive WebXR AR capability detection.
 * Checks all requirements before allowing AR mode.
 */
export async function checkWebXRCapabilities(): Promise<CapabilityResult> {
  const checks: CapabilityChecks = {
    secureContext: false,
    xrAvailable: false,
    immersiveARSupported: false,
    requiredFeaturesSupported: false,
  };

  // Check 1: Secure context (HTTPS)
  if (typeof window !== 'undefined') {
    checks.secureContext = window.isSecureContext;
  }

  if (!checks.secureContext) {
    return {
      supported: false,
      checks,
      errorMessage: 'WebXR requires a secure context (HTTPS). Please access this site over HTTPS.',
    };
  }

  // Check 2: WebXR API availability
  if (typeof navigator !== 'undefined' && 'xr' in navigator) {
    checks.xrAvailable = true;
  }

  if (!checks.xrAvailable) {
    return {
      supported: false,
      checks,
      errorMessage: 'WebXR API is not available. Please use a supported browser like Chrome on Android.',
    };
  }

  // Check 3: Immersive AR support
  try {
    const xr = navigator.xr!;
    checks.immersiveARSupported = await xr.isSessionSupported('immersive-ar');
  } catch (error) {
    checks.immersiveARSupported = false;
  }

  if (!checks.immersiveARSupported) {
    return {
      supported: false,
      checks,
      errorMessage: 'Immersive AR is not supported. This device may not have ARCore or AR capabilities.',
    };
  }

  // Check 4: Required features (hit-test, local-floor)
  // We attempt to request a session with these features and immediately end it
  try {
    const xr = navigator.xr!;
    const testSession = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local-floor'],
    });
    // Successfully created session - features are supported
    await testSession.end();
    checks.requiredFeaturesSupported = true;
  } catch (error) {
    checks.requiredFeaturesSupported = false;
    return {
      supported: false,
      checks,
      errorMessage: 'Required AR features (hit-test, local-floor) are not supported on this device.',
    };
  }

  // All checks passed
  return {
    supported: true,
    checks,
  };
}

/**
 * Get human-readable status for each capability check
 */
export function getCheckStatus(checks: CapabilityChecks): Array<{
  name: string;
  passed: boolean;
  description: string;
}> {
  return [
    {
      name: 'Secure Context',
      passed: checks.secureContext,
      description: 'Site accessed over HTTPS',
    },
    {
      name: 'WebXR API',
      passed: checks.xrAvailable,
      description: 'Browser supports WebXR',
    },
    {
      name: 'Immersive AR',
      passed: checks.immersiveARSupported,
      description: 'Device supports AR mode',
    },
    {
      name: 'AR Features',
      passed: checks.requiredFeaturesSupported,
      description: 'Hit-test and local-floor supported',
    },
  ];
}

/**
 * Get troubleshooting steps for unsupported devices
 */
export function getTroubleshootingSteps(): string[] {
  return [
    'Use an Android phone with ARCore support (most phones from 2018+)',
    'Update Chrome to the latest version',
    'Access this site over HTTPS (not HTTP)',
    'Enable camera permissions for this site',
    'Ensure Google Play Services for AR is installed and updated',
    'Try restarting Chrome if issues persist',
  ];
}
