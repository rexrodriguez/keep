/**
 * Main-thread manager for the segmentation Web Worker
 * Handles worker lifecycle, communication, and result callbacks
 */

import type { SegmentBounds, WorkerInMessage, WorkerOutMessage } from './segmenter-worker';

export type { SegmentBounds };

export class SegmenterManager {
  private worker: Worker | null = null;
  private ready = false;
  private processing = false;
  private pendingResolve: ((bounds: SegmentBounds | null) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;

  /**
   * Initialize the segmenter worker
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create worker
        this.worker = new Worker(
          new URL('./segmenter-worker.ts', import.meta.url),
          { type: 'module' }
        );

        // Handle messages from worker
        this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
          this.handleWorkerMessage(event.data);
        };

        this.worker.onerror = (error) => {
          console.error('Segmenter worker error:', error);
          if (!this.ready) {
            reject(new Error('Worker initialization failed'));
          }
        };

        // Store resolve/reject for init
        const initResolve = resolve;
        const initReject = reject;

        // Override message handler temporarily for init
        const originalHandler = this.worker.onmessage;
        this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
          const message = event.data;
          if (message.type === 'INIT_COMPLETE') {
            this.ready = true;
            this.worker!.onmessage = originalHandler;
            initResolve();
          } else if (message.type === 'INIT_FAILED') {
            this.worker!.onmessage = originalHandler;
            initReject(new Error(message.error));
          }
        };

        // Send init message
        const initMessage: WorkerInMessage = {
          type: 'INIT',
          wasmPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
          modelPath: '/models/deeplab_v3.tflite',
        };
        this.worker.postMessage(initMessage);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(message: WorkerOutMessage): void {
    switch (message.type) {
      case 'SEGMENT_RESULT':
        this.processing = false;
        if (this.pendingResolve) {
          this.pendingResolve(message.bounds);
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        break;

      case 'SEGMENT_ERROR':
        this.processing = false;
        if (this.pendingReject) {
          this.pendingReject(new Error(message.error));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        break;
    }
  }

  /**
   * Run segmentation at a specific tap point
   * @param imageData - The camera frame as ImageBitmap
   * @param tapX - Normalized X coordinate of tap (0-1)
   * @param tapY - Normalized Y coordinate of tap (0-1)
   * @returns Promise resolving to segment bounds or null
   */
  async segmentAtPoint(
    imageData: ImageBitmap,
    tapX: number,
    tapY: number
  ): Promise<SegmentBounds | null> {
    if (!this.worker || !this.ready) {
      throw new Error('Segmenter not initialized');
    }

    if (this.processing) {
      throw new Error('Segmentation already in progress');
    }

    this.processing = true;

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      const message: WorkerInMessage = {
        type: 'SEGMENT',
        imageData,
        timestamp: performance.now(),
        tapX,
        tapY,
      };

      // Transfer the ImageBitmap to avoid copying
      this.worker!.postMessage(message, [imageData]);
    });
  }

  /**
   * Check if the segmenter is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Check if segmentation is in progress
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Dispose of the worker
   */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.processing = false;
    this.pendingResolve = null;
    this.pendingReject = null;
  }
}
