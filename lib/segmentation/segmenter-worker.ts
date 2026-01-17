/**
 * Web Worker for MediaPipe Image Segmentation
 * Runs segmentation off the main thread to avoid blocking AR rendering
 */

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

// Message types
export interface SegmentBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
}

export type WorkerInMessage =
  | { type: 'INIT'; wasmPath: string; modelPath: string }
  | { type: 'SEGMENT'; imageData: ImageBitmap; timestamp: number; tapX: number; tapY: number };

export type WorkerOutMessage =
  | { type: 'INIT_COMPLETE' }
  | { type: 'INIT_FAILED'; error: string }
  | { type: 'SEGMENT_RESULT'; bounds: SegmentBounds | null; timestamp: number }
  | { type: 'SEGMENT_ERROR'; error: string };

let segmenter: ImageSegmenter | null = null;

/**
 * Find the segment bounds at a specific tap point
 * Returns the bounding box of all pixels with the same category as the tap point
 */
function findSegmentAtPoint(
  maskData: Uint8Array,
  width: number,
  height: number,
  tapX: number,
  tapY: number
): SegmentBounds | null {
  const px = Math.floor(tapX * width);
  const py = Math.floor(tapY * height);

  // Bounds check
  if (px < 0 || px >= width || py < 0 || py >= height) {
    return null;
  }

  const tapCategory = maskData[py * width + px];

  // Category 0 is typically background
  if (tapCategory === 0) {
    return null;
  }

  // Find all pixels with the same category
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (maskData[y * width + x] === tapCategory) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        count++;
      }
    }
  }

  if (count === 0) {
    return null;
  }

  // Return normalized coordinates (0-1)
  return {
    minX: minX / width,
    maxX: maxX / width,
    minY: minY / height,
    maxY: maxY / height,
    centerX: (minX + maxX) / 2 / width,
    centerY: (minY + maxY) / 2 / height,
    pixelCount: count,
  };
}

/**
 * Initialize the segmenter
 */
async function initializeSegmenter(wasmPath: string, modelPath: string): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(wasmPath);

  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: 'GPU',
    },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: 'VIDEO',
  });
}

/**
 * Run segmentation on an image
 */
function runSegmentation(
  imageData: ImageBitmap,
  timestamp: number,
  tapX: number,
  tapY: number
): SegmentBounds | null {
  if (!segmenter) {
    throw new Error('Segmenter not initialized');
  }

  // Run segmentation
  const result = segmenter.segmentForVideo(imageData, timestamp);

  if (!result.categoryMask) {
    return null;
  }

  const mask = result.categoryMask;
  const maskData = mask.getAsUint8Array();
  const width = mask.width;
  const height = mask.height;

  // Find segment at tap point
  const bounds = findSegmentAtPoint(maskData, width, height, tapX, tapY);

  // Clean up
  result.close();

  return bounds;
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'INIT':
      try {
        await initializeSegmenter(message.wasmPath, message.modelPath);
        self.postMessage({ type: 'INIT_COMPLETE' } as WorkerOutMessage);
      } catch (error) {
        self.postMessage({
          type: 'INIT_FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
        } as WorkerOutMessage);
      }
      break;

    case 'SEGMENT':
      try {
        const bounds = runSegmentation(
          message.imageData,
          message.timestamp,
          message.tapX,
          message.tapY
        );

        // Close the ImageBitmap to free memory
        message.imageData.close();

        self.postMessage({
          type: 'SEGMENT_RESULT',
          bounds,
          timestamp: message.timestamp,
        } as WorkerOutMessage);
      } catch (error) {
        self.postMessage({
          type: 'SEGMENT_ERROR',
          error: error instanceof Error ? error.message : 'Unknown error',
        } as WorkerOutMessage);
      }
      break;
  }
};
