'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor } from '@/lib/three/reticle';
import { updateBoundingBox, disposeBoundingBox } from '@/lib/three/bounding-box';
import { PoseStabilizer } from '@/lib/measurement/stabilization';
import {
  stateMachineReducer,
  initialContext,
  StateAction,
  canStartDrag,
  isDragging,
  StateMachineContext,
} from '@/lib/measurement/state-machine';
import {
  calculateMeasurementsFromDragRect,
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
  const stabilizerRef = useRef<PoseStabilizer>(new PoseStabilizer());
  const renderLoopRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  const [context, setContext] = useState<StateMachineContext>(initialContext);
  const [measurements, setMeasurements] = useState<ComputedMeasurements | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);

  // Current hit position for drag capture
  const currentHitRef = useRef<{ position: THREE.Vector3; stability: number } | null>(null);
  // Track if currently in a touch gesture
  const isTouchingRef = useRef(false);

  const dispatch = useCallback((action: StateAction) => {
    setContext((prev) => stateMachineReducer(prev, action));
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

  // Update bounding box when drag points or height change
  useEffect(() => {
    if (sceneContextRef.current) {
      // Show bounding box during drawing, height input, or review
      const showBox = context.dragStart && context.dragEnd;

      if (showBox) {
        updateBoundingBox(
          sceneContextRef.current.scene,
          context.dragStart,
          context.dragEnd,
          context.height_m
        );
      } else {
        disposeBoundingBox(sceneContextRef.current.scene);
      }
    }
  }, [context.dragStart, context.dragEnd, context.height_m]);

  // Update measurements when drag ends or height changes
  useEffect(() => {
    if (context.dragStart && context.dragEnd && context.state !== 'DRAWING') {
      const data = calculateMeasurementsFromDragRect(
        context.dragStart,
        context.dragEnd,
        context.height_m
      );
      setMeasurements(toComputedMeasurements(data));
      setConfidence(data.confidence);
    } else if (!context.dragStart || !context.dragEnd) {
      setMeasurements(null);
      setConfidence(null);
    }
  }, [context.dragStart, context.dragEnd, context.height_m, context.state]);

  const handleFrame = useCallback((data: FrameData) => {
    const { hitTest } = data;

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
      currentHitRef.current = {
        position: stability.averagedPosition.clone(),
        stability: stability.stability,
      };

      setTrackingWarning(null);
    } else {
      currentHitRef.current = null;
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
      disposeScene(sceneContextRef.current);
    }
  }, []);

  // Handle touch start - begin drag
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't start drag if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    if (!canStartDrag(context.state)) {
      return;
    }

    if (!currentHitRef.current) {
      return;
    }

    isTouchingRef.current = true;

    const point: MeasurementPoint = {
      position: currentHitRef.current.position.clone(),
      timestamp: Date.now(),
      stability: currentHitRef.current.stability,
    };

    dispatch({ type: 'START_DRAG', point });
  }, [context.state, dispatch]);

  // Handle touch move - update drag end point
  const handleTouchMove = useCallback(() => {
    if (!isDragging(context.state)) {
      return;
    }

    if (!currentHitRef.current) {
      return;
    }

    const point: MeasurementPoint = {
      position: currentHitRef.current.position.clone(),
      timestamp: Date.now(),
      stability: currentHitRef.current.stability,
    };

    dispatch({ type: 'UPDATE_DRAG', point });
  }, [context.state, dispatch]);

  // Handle touch end - finish drag
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Don't end drag if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    if (!isDragging(context.state)) {
      isTouchingRef.current = false;
      return;
    }

    isTouchingRef.current = false;

    // Use the last known hit position
    if (!currentHitRef.current || !context.dragStart) {
      dispatch({ type: 'UNDO' }); // Cancel if no valid position
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

  const handleSetHeight = useCallback((height_m: number) => {
    dispatch({ type: 'SET_HEIGHT', height_m });
  }, [dispatch]);

  const handleConfirmHeight = useCallback(() => {
    dispatch({ type: 'CONFIRM_HEIGHT' });
  }, [dispatch]);

  const handleFindStorage = useCallback(() => {
    if (context.dragStart && context.dragEnd) {
      const data = calculateMeasurementsFromDragRect(
        context.dragStart,
        context.dragEnd,
        context.height_m
      );
      onFindStorage(data);
    }
  }, [context.dragStart, context.dragEnd, context.height_m, onFindStorage]);

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
        onUndo={handleUndo}
        onReset={handleReset}
        onSetHeight={handleSetHeight}
        onConfirmHeight={handleConfirmHeight}
        onFindStorage={handleFindStorage}
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
