'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor } from '@/lib/three/reticle';
import { createTargetMarker, updateTargetMarker, disposeTargetMarker } from '@/lib/three/target-marker';
import { updateBoundingBox, disposeBoundingBox } from '@/lib/three/bounding-box';
import { PoseStabilizer, StabilityMode } from '@/lib/measurement/stabilization';
import { captureXRCameraImage, captureRendererFallback } from '@/lib/webxr/camera-capture';
import { raycastCornerHandles } from '@/lib/three/raycasting';
import { calculateSimpleCornerDrag } from '@/lib/three/corner-drag';
import {
  stateMachineReducer,
  initialContext,
  StateAction,
  canStartDrag,
  isDragging,
  StateMachineContext,
  LLMEstimate,
} from '@/lib/measurement/state-machine';
import {
  calculateMeasurementsFromDragRect,
  calculateMeasurementsFromLLM,
  toComputedMeasurements,
} from '@/lib/measurement/calculations';
import { MeasurementPoint, ComputedMeasurements, ConfidenceLevel, MeasurementData } from '@/lib/types';
import MeasurementUI from './MeasurementUI';

interface ARSessionProps {
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onExit: () => void;
  onFindStorage: (measurements: MeasurementData) => void;
}

export default function ARSession({ overlayRef, onExit, onFindStorage }: ARSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneContextRef = useRef<SceneContext | null>(null);
  const xrContextRef = useRef<XRSessionContext | null>(null);
  const reticleRef = useRef<THREE.Group | null>(null);
  const targetMarkerRef = useRef<THREE.Group | null>(null);
  const stabilizerRef = useRef<PoseStabilizer>(new PoseStabilizer());
  const renderLoopRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  const [context, setContext] = useState<StateMachineContext>(initialContext);
  const [measurements, setMeasurements] = useState<ComputedMeasurements | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [stabilityMode, setStabilityMode] = useState<StabilityMode>('balanced');

  // Current hit position for drag capture
  const currentHitRef = useRef<{ position: THREE.Vector3; stability: number } | null>(null);
  // Cache last valid hit for continuous dragging (Option 3: Aggressive caching)
  const lastValidHitRef = useRef<{ position: THREE.Vector3; stability: number; timestamp: number } | null>(null);
  // Store latest frame for camera capture
  const currentFrameRef = useRef<XRFrame | null>(null);
  // Track touch gesture state
  const isTouchingRef = useRef(false);
  const touchStartRef = useRef<{ time: number; position: THREE.Vector3 } | null>(null);
  const hasDraggedRef = useRef(false);

  const dispatch = useCallback((action: StateAction) => {
    setContext((prev) => stateMachineReducer(prev, action));
  }, []);

  // Check if AI features are available
  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => setAiEnabled(data.hasOpenAIKey))
      .catch(() => setAiEnabled(false));
  }, []);

  // Initialize AR session
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!containerRef.current) return;

      try {
        // Create Three.js scene
        const sceneCtx = createARScene(containerRef.current);
        sceneContextRef.current = sceneCtx;

        // Create reticle
        const reticle = createReticle();
        sceneCtx.scene.add(reticle);
        reticleRef.current = reticle;

        // Create target marker for LLM estimation
        const targetMarker = createTargetMarker();
        sceneCtx.scene.add(targetMarker);
        targetMarkerRef.current = targetMarker;

        // Start AR session
        const xrCtx = await startARSession(
          sceneCtx.renderer,
          overlayRef.current || undefined
        );
        xrContextRef.current = xrCtx;

        // Create render loop
        const loop = createRenderLoop(
          xrCtx,
          sceneCtx.scene,
          sceneCtx.camera,
          handleFrame
        );
        renderLoopRef.current = loop;
        loop.start();

        if (mounted) {
          dispatch({ type: 'AR_STARTED' });
        }
      } catch (error) {
        console.error('Failed to start AR session:', error);
        if (mounted) {
          dispatch({
            type: 'AR_FAILED',
            error: error instanceof Error ? error.message : 'Failed to start AR',
          });
        }
      }
    }

    init();

    return () => {
      mounted = false;
      cleanup();
    };
  }, [dispatch, overlayRef]);

  // Update target marker when target point changes
  useEffect(() => {
    if (targetMarkerRef.current) {
      updateTargetMarker(
        targetMarkerRef.current,
        context.targetPoint?.position || null,
        context.targetPoint !== null && context.state === 'READY_TO_DRAW'
      );
    }
  }, [context.targetPoint, context.state]);

  // Update bounding box when drag points or dimensions change
  useEffect(() => {
    if (sceneContextRef.current) {
      // Show bounding box during drawing, height input, or review
      const showBox = context.dragStart && context.dragEnd;

      if (showBox) {
        // In LLM mode, pass width/depth overrides so sliders affect the box
        const isLLMMode = context.llmEstimate !== null;
        updateBoundingBox(
          sceneContextRef.current.scene,
          context.dragStart,
          context.dragEnd,
          context.height_m,
          isLLMMode ? context.width_m : undefined,
          isLLMMode ? context.depth_m : undefined,
          context.rotation_deg
        );
      } else {
        disposeBoundingBox(sceneContextRef.current.scene);
      }
    }
  }, [context.dragStart, context.dragEnd, context.height_m, context.width_m, context.depth_m, context.rotation_deg, context.llmEstimate]);

  // Update measurements when dimensions change
  useEffect(() => {
    if (context.dragStart && context.dragEnd && context.state !== 'DRAWING') {
      // Check if we're in LLM mode (have an estimate)
      if (context.llmEstimate) {
        const data = calculateMeasurementsFromLLM(
          context.dragStart,
          context.width_m,
          context.depth_m,
          context.height_m,
          context.llmEstimate.confidence
        );
        setMeasurements(toComputedMeasurements(data));
        setConfidence(data.confidence);
      } else {
        const data = calculateMeasurementsFromDragRect(
          context.dragStart,
          context.dragEnd,
          context.height_m
        );
        setMeasurements(toComputedMeasurements(data));
        setConfidence(data.confidence);
      }
    } else if (!context.dragStart || !context.dragEnd) {
      setMeasurements(null);
      setConfidence(null);
    }
  }, [context.dragStart, context.dragEnd, context.height_m, context.width_m, context.depth_m, context.state, context.llmEstimate]);

  const handleFrame = useCallback((data: FrameData) => {
    const { hitTest, frame } = data;

    // Store frame for camera capture
    currentFrameRef.current = frame;

    // Update reticle
    if (reticleRef.current) {
      updateReticle(
        reticleRef.current,
        hitTest.position,
        hitTest.quaternion,
        hitTest.hasHit
      );
    }

    // Update stabilizer and current hit
    if (hitTest.hasHit) {
      stabilizerRef.current.addFrame(hitTest.position);
      const stability = stabilizerRef.current.checkStability();

      // Update reticle color based on stability
      if (reticleRef.current) {
        setReticleColor(reticleRef.current, stability.isStable);
      }

      // Store current hit for drag capture
      const hitData = {
        position: stability.averagedPosition.clone(),
        stability: stability.stability,
      };
      currentHitRef.current = hitData;

      // Cache this as last valid hit (with timestamp for age tracking)
      lastValidHitRef.current = {
        ...hitData,
        timestamp: performance.now(),
      };

      setTrackingWarning(null);
    } else {
      currentHitRef.current = null;
      // Don't clear lastValidHitRef - keep it for dragging continuity
      setTrackingWarning('Point at a flat surface');
    }
  }, []);

  const cleanup = useCallback(() => {
    if (renderLoopRef.current) {
      renderLoopRef.current.stop();
    }

    if (xrContextRef.current) {
      endARSession(xrContextRef.current).catch(console.error);
    }

    if (sceneContextRef.current) {
      disposeBoundingBox(sceneContextRef.current.scene);
      disposeTargetMarker(sceneContextRef.current.scene);
      disposeScene(sceneContextRef.current);
    }
  }, []);

  // Handle touch start - begin tracking touch
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't handle if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    // Check for corner handle touch first (in HEIGHT_INPUT or REVIEW states)
    if ((context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW') && sceneContextRef.current) {
      const touch = e.touches[0];
      const canvas = sceneContextRef.current.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const screenX = touch.clientX - rect.left;
      const screenY = touch.clientY - rect.top;

      const cornerHit = raycastCornerHandles(
        screenX,
        screenY,
        sceneContextRef.current.camera,
        sceneContextRef.current.scene,
        rect.width,
        rect.height
      );

      if (cornerHit) {
        isTouchingRef.current = true;
        hasDraggedRef.current = true; // Corner drag is always a drag
        touchStartRef.current = {
          time: Date.now(),
          position: cornerHit.worldPosition.clone(),
        };
        dispatch({ type: 'START_CORNER_DRAG', cornerIndex: cornerHit.cornerIndex });
        return;
      }
    }

    if (!canStartDrag(context.state)) {
      return;
    }

    if (!currentHitRef.current) {
      return;
    }

    isTouchingRef.current = true;
    hasDraggedRef.current = false;
    touchStartRef.current = {
      time: Date.now(),
      position: currentHitRef.current.position.clone(),
    };

    // Start drag immediately (will be converted to tap if short enough)
    const point: MeasurementPoint = {
      position: currentHitRef.current.position.clone(),
      timestamp: Date.now(),
      stability: currentHitRef.current.stability,
    };

    dispatch({ type: 'START_DRAG', point });
  }, [context.state, dispatch]);

  // Handle touch move - update drag end point
  const handleTouchMove = useCallback(() => {
    if (!isTouchingRef.current) {
      return;
    }

    if (!touchStartRef.current) {
      return;
    }

    // Use current hit if available, otherwise fall back to last valid hit (Option 3: Aggressive caching)
    // Allow cached hit up to 100ms old during active dragging
    let hitToUse = currentHitRef.current;
    if (!hitToUse && lastValidHitRef.current) {
      const age = performance.now() - lastValidHitRef.current.timestamp;
      if (age < 100) {
        hitToUse = lastValidHitRef.current;
      }
    }

    if (!hitToUse) {
      return;
    }

    // Check if we've moved enough to count as a drag (> 3cm)
    const distance = hitToUse.position.distanceTo(touchStartRef.current.position);
    if (distance > 0.03) {
      hasDraggedRef.current = true;
    }

    if (!isDragging(context.state)) {
      return;
    }

    // Handle corner dragging separately
    if (context.cornerDragIndex !== null) {
      // Corner drag - update box dimensions and rotation
      if (context.dragStart && context.dragEnd) {
        const result = calculateSimpleCornerDrag(
          context.cornerDragIndex,
          context.dragStart,
          context.dragEnd,
          hitToUse.position,
          context.rotation_deg
        );

        // Update context with new drag points and rotation
        setContext((prev) => ({
          ...prev,
          dragStart: result.newDragStart,
          dragEnd: result.newDragEnd,
          rotation_deg: result.newRotation,
        }));
      }
      return;
    }

    const point: MeasurementPoint = {
      position: hitToUse.position.clone(),
      timestamp: Date.now(),
      stability: hitToUse.stability,
    };

    dispatch({ type: 'UPDATE_DRAG', point });
  }, [context.state, context.cornerDragIndex, context.dragStart, context.dragEnd, context.rotation_deg, dispatch]);

  // Handle touch end - finish drag or set target
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Don't handle if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    const wasTouching = isTouchingRef.current;
    const touchStart = touchStartRef.current;
    const hasDragged = hasDraggedRef.current;

    isTouchingRef.current = false;
    touchStartRef.current = null;
    hasDraggedRef.current = false;

    if (!wasTouching || !touchStart) {
      return;
    }

    // Handle corner drag end
    if (context.cornerDragIndex !== null) {
      dispatch({ type: 'END_CORNER_DRAG' });
      return;
    }

    // Determine if this was a tap (short duration, no movement) or drag
    const duration = Date.now() - touchStart.time;
    const isTap = duration < 300 && !hasDragged;

    if (isTap) {
      // Cancel any started drag
      dispatch({ type: 'UNDO' });

      // Only set target for AI if AI is enabled
      if (aiEnabled && currentHitRef.current) {
        const point: MeasurementPoint = {
          position: touchStart.position.clone(),
          timestamp: Date.now(),
          stability: currentHitRef.current.stability,
        };
        dispatch({ type: 'SET_TARGET', point });
      }
      return;
    }

    // It was a drag - finish it
    if (!isDragging(context.state)) {
      return;
    }

    if (!currentHitRef.current || !context.dragStart) {
      dispatch({ type: 'UNDO' });
      return;
    }

    const point: MeasurementPoint = {
      position: currentHitRef.current.position.clone(),
      timestamp: Date.now(),
      stability: currentHitRef.current.stability,
    };

    dispatch({ type: 'END_DRAG', point });
  }, [context.state, context.dragStart, dispatch]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
    stabilizerRef.current.reset();
  }, [dispatch]);

  const handleSetWidth = useCallback((width_m: number) => {
    dispatch({ type: 'SET_WIDTH', width_m });
  }, [dispatch]);

  const handleSetDepth = useCallback((depth_m: number) => {
    dispatch({ type: 'SET_DEPTH', depth_m });
  }, [dispatch]);

  const handleSetHeight = useCallback((height_m: number) => {
    dispatch({ type: 'SET_HEIGHT', height_m });
  }, [dispatch]);

  const handleSetRotation = useCallback((rotation_deg: number) => {
    dispatch({ type: 'SET_ROTATION', rotation_deg });
  }, [dispatch]);

  const handleConfirmHeight = useCallback(() => {
    dispatch({ type: 'CONFIRM_HEIGHT' });
  }, [dispatch]);

  const handleClearTarget = useCallback(() => {
    dispatch({ type: 'CLEAR_TARGET' });
  }, [dispatch]);

  const handleSetStabilityMode = useCallback((mode: StabilityMode) => {
    setStabilityMode(mode);
    if (stabilizerRef.current) {
      stabilizerRef.current.setMode(mode);
    }
  }, []);

  // Handle LLM capture and estimation
  const handleCaptureEstimate = useCallback(async () => {
    if (!xrContextRef.current || !context.targetPoint) {
      dispatch({ type: 'LLM_ESTIMATE_FAILED', error: 'Please tap to mark a target first' });
      return;
    }

    dispatch({ type: 'START_LLM_ESTIMATE' });

    try {
      // Try to capture using raw camera access first
      let image: string | null = null;

      if (currentFrameRef.current && xrContextRef.current.glBinding) {
        image = await captureXRCameraImage(
          xrContextRef.current.renderer,
          xrContextRef.current.glBinding,
          currentFrameRef.current,
          xrContextRef.current.localFloorSpace
        );
      }

      // Fall back to renderer capture if raw camera access failed
      if (!image) {
        console.warn('Raw camera access failed, using renderer fallback');
        image = captureRendererFallback(xrContextRef.current.renderer);
      }

      if (!image) {
        dispatch({ type: 'LLM_ESTIMATE_FAILED', error: 'Failed to capture image' });
        return;
      }

      // Send to API
      const response = await fetch('/api/estimate-dimensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });

      const data = await response.json();

      if (!data.success || !data.estimate) {
        dispatch({ type: 'LLM_ESTIMATE_FAILED', error: data.error || 'Failed to estimate dimensions' });
        return;
      }

      dispatch({
        type: 'LLM_ESTIMATE_COMPLETE',
        estimate: data.estimate as LLMEstimate,
      });
    } catch (error) {
      console.error('LLM estimation error:', error);
      dispatch({
        type: 'LLM_ESTIMATE_FAILED',
        error: error instanceof Error ? error.message : 'Network error',
      });
    }
  }, [context.targetPoint, dispatch]);

  const handleFindStorage = useCallback(() => {
    if (context.dragStart && context.dragEnd) {
      let data: MeasurementData;

      if (context.llmEstimate) {
        data = calculateMeasurementsFromLLM(
          context.dragStart,
          context.width_m,
          context.depth_m,
          context.height_m,
          context.llmEstimate.confidence
        );
      } else {
        data = calculateMeasurementsFromDragRect(
          context.dragStart,
          context.dragEnd,
          context.height_m
        );
      }

      onFindStorage(data);
    }
  }, [context.dragStart, context.dragEnd, context.height_m, context.width_m, context.depth_m, context.llmEstimate, onFindStorage]);

  const handleExit = useCallback(() => {
    cleanup();
    dispatch({ type: 'END_SESSION' });
    onExit();
  }, [cleanup, dispatch, onExit]);

  // Render UI into the overlay container via portal so it shows during AR
  const overlayContent = (
    <div
      className="fixed inset-0"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
      {/* Measurement UI overlay */}
      <MeasurementUI
        context={context}
        measurements={measurements}
        confidence={confidence}
        trackingWarning={trackingWarning}
        aiEnabled={aiEnabled}
        stabilityMode={stabilityMode}
        onUndo={handleUndo}
        onReset={handleReset}
        onSetWidth={handleSetWidth}
        onSetDepth={handleSetDepth}
        onSetHeight={handleSetHeight}
        onSetRotation={handleSetRotation}
        onConfirmHeight={handleConfirmHeight}
        onCaptureEstimate={handleCaptureEstimate}
        onClearTarget={handleClearTarget}
        onFindStorage={handleFindStorage}
        onSetStabilityMode={handleSetStabilityMode}
        onExit={handleExit}
      />
    </div>
  );

  return (
    <>
      {/* Three.js container */}
      <div
        ref={containerRef}
        className="fixed inset-0"
      />

      {/* Portal UI into the overlay element so it renders during AR session */}
      {overlayRef.current && createPortal(overlayContent, overlayRef.current)}
    </>
  );
}
