import * as THREE from 'three';

/**
 * Capture camera image using WebXR Raw Camera Access API
 * This gets the actual camera feed, not just the WebGL overlay
 */
export async function captureXRCameraImage(
  renderer: THREE.WebGLRenderer,
  glBinding: XRWebGLBinding | null,
  frame: XRFrame,
  referenceSpace: XRReferenceSpace
): Promise<string | null> {
  if (!glBinding) {
    console.warn('No WebGL binding available for camera capture');
    return null;
  }

  try {
    const pose = frame.getViewerPose(referenceSpace);
    if (!pose || pose.views.length === 0) {
      console.warn('No viewer pose available');
      return null;
    }

    const view = pose.views[0];

    // Check if camera access is available on this view
    const camera = (view as any).camera;
    if (!camera) {
      console.warn('Camera not available on XRView - camera-access may not be granted');
      return null;
    }

    // Get the camera texture
    const cameraTexture = (glBinding as any).getCameraImage(camera);
    if (!cameraTexture) {
      console.warn('Failed to get camera texture');
      return null;
    }

    // Read pixels from the camera texture
    const gl = renderer.getContext();
    const width = camera.width;
    const height = camera.height;

    // Create framebuffer to read from the texture
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);

    // Check framebuffer status
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn('Framebuffer not complete:', status);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    // Read pixels
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Clean up
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);

    // Convert to canvas and then to base64
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    // Create ImageData and flip vertically (WebGL is bottom-up)
    const imageData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((height - 1 - y) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        imageData.data[dstIdx] = pixels[srcIdx];
        imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
        imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
        imageData.data[dstIdx + 3] = pixels[srcIdx + 3];
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // Resize if needed and convert to base64
    return resizeAndConvert(canvas, 800);
  } catch (error) {
    console.error('Failed to capture XR camera image:', error);
    return null;
  }
}

/**
 * Resize canvas and convert to base64 JPEG
 */
function resizeAndConvert(canvas: HTMLCanvasElement, maxWidth: number): string {
  let targetCanvas = canvas;

  if (canvas.width > maxWidth) {
    const scale = maxWidth / canvas.width;
    const newWidth = maxWidth;
    const newHeight = Math.round(canvas.height * scale);

    targetCanvas = document.createElement('canvas');
    targetCanvas.width = newWidth;
    targetCanvas.height = newHeight;
    const ctx = targetCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, newWidth, newHeight);
    }
  }

  return targetCanvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Fallback: Capture from renderer canvas (only gets the 3D overlay, not camera)
 */
export function captureRendererFallback(renderer: THREE.WebGLRenderer): string | null {
  try {
    const canvas = renderer.domElement;
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.error('Failed to capture from renderer:', error);
    return null;
  }
}
