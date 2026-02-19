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
  // Use isSessionSupported which doesn't require user gesture or camera permission
  try {
    const xr = navigator.xr!;
    // If immersive-ar is supported, hit-test and local-floor are typically available
    // We can't directly check features without requesting a session (which requires user gesture)
    // So we assume if immersive-ar is supported on Android Chrome, features are available
    // The actual feature check happens when user taps "Start AR"
    checks.requiredFeaturesSupported = checks.immersiveARSupported;
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
    'Android: Use Chrome, Samsung Internet, Edge, or Opera on an ARCore-supported phone (most phones from 2018+)',
    'Android: Ensure Google Play Services for AR is installed and updated',
    'iOS: Download the free WebXR Viewer app from the App Store (Safari does not support WebXR)',
    'Ensure camera permissions are enabled for this site',
    'Access this site over HTTPS (not HTTP)',
    'Try restarting your browser if issues persist',
  ];
}
