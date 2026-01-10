import * as THREE from 'three';

/**
 * Capture the current WebXR camera view as a base64 image
 */
export function captureFrame(renderer: THREE.WebGLRenderer): string | null {
  try {
    const canvas = renderer.domElement;

    // The WebGL context may need preserveDrawingBuffer for this to work
    // In WebXR, the canvas contains the camera feed + rendered overlay
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    return dataUrl;
  } catch (error) {
    console.error('Failed to capture frame:', error);
    return null;
  }
}

/**
 * Capture frame with a specific resolution for API upload
 * Resizes the captured image to reduce bandwidth
 */
export async function captureFrameResized(
  renderer: THREE.WebGLRenderer,
  maxWidth: number = 800
): Promise<string | null> {
  try {
    const canvas = renderer.domElement;

    // Get original dimensions
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;

    // Calculate new dimensions maintaining aspect ratio
    let newWidth = originalWidth;
    let newHeight = originalHeight;

    if (originalWidth > maxWidth) {
      newWidth = maxWidth;
      newHeight = Math.round((originalHeight / originalWidth) * maxWidth);
    }

    // Create temporary canvas for resizing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = newWidth;
    tempCanvas.height = newHeight;

    const ctx = tempCanvas.getContext('2d');
    if (!ctx) {
      return captureFrame(renderer);
    }

    // Draw resized image
    ctx.drawImage(canvas, 0, 0, newWidth, newHeight);

    // Return as base64
    return tempCanvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error('Failed to capture and resize frame:', error);
    return null;
  }
}

/**
 * Capture using WebXR camera texture (experimental)
 * This requires the 'camera-access' feature which may not be available
 */
export function captureXRCamera(frame: XRFrame): string | null {
  // WebXR Raw Camera Access is still experimental
  // For now, we use the canvas capture method above
  // This is a placeholder for future implementation
  return null;
}
