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
import {
  stateMachineReducer,
  initialContext,
  StateAction,
  isDragging,
  StateMachineContext,
} from '@/lib/measurement/state-machine';
import {
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
        // Always pass width/depth from state so rollers affect the box
        updateBoundingBox(
          sceneContextRef.current.scene,
          context.dragStart,
          context.dragEnd,
          context.height_m,
          context.width_m,
          context.depth_m,
          context.rotation_deg
        );
      } else {
        disposeBoundingBox(sceneContextRef.current.scene);
      }
    }
  }, [context.dragStart, context.dragEnd, context.height_m, context.width_m, context.depth_m, context.rotation_deg]);

  // Update measurements when dimensions change
  useEffect(() => {
    if (context.dragStart && context.dragEnd && context.state !== 'DRAWING') {
      // Always use width/depth/height from state
      const data = calculateMeasurementsFromLLM(
        context.dragStart,
        context.width_m,
        context.depth_m,
        context.height_m,
        context.llmEstimate?.confidence || 'MEDIUM'
      );
      setMeasurements(toComputedMeasurements(data));
      setConfidence(data.confidence);
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

    // Only track touch in READY_TO_DRAW state (for tap-to-place)
    if (context.state !== 'READY_TO_DRAW') {
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
  }, [context.state]);

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

    const point: MeasurementPoint = {
      position: hitToUse.position.clone(),
      timestamp: Date.now(),
      stability: hitToUse.stability,
    };

    dispatch({ type: 'UPDATE_DRAG', point });
  }, [context.state, dispatch]);

  // Handle touch end - place box on tap
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Don't handle if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    const wasTouching = isTouchingRef.current;
    const touchStart = touchStartRef.current;

    isTouchingRef.current = false;
    touchStartRef.current = null;
    hasDraggedRef.current = false;

    if (!wasTouching || !touchStart) {
      return;
    }

    // In READY_TO_DRAW state, tap places a box
    if (context.state === 'READY_TO_DRAW') {
      const point: MeasurementPoint = {
        position: touchStart.position.clone(),
        timestamp: Date.now(),
        stability: currentHitRef.current?.stability || 0.5,
      };
      dispatch({ type: 'PLACE_BOX', point });
      return;
    }
  }, [context.state, dispatch]);

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

  const handleMoveBox = useCallback((joystickX: number, joystickZ: number) => {
    // Transform joystick input from camera-relative to world coordinates
    // joystickX = left/right relative to camera view
    // joystickZ = forward/back relative to camera view

    const camera = sceneContextRef.current?.camera;
    if (!camera) {
      // Fallback to direct mapping if no camera
      dispatch({ type: 'MOVE_BOX', deltaX: joystickX, deltaZ: joystickZ });
      return;
    }

    // Get camera's forward direction projected onto XZ plane (ignore Y)
    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);
    cameraDir.y = 0;
    cameraDir.normalize();

    // Camera's right direction (perpendicular to forward on XZ plane)
    const cameraRight = new THREE.Vector3(-cameraDir.z, 0, cameraDir.x);

    // Transform joystick input to world space:
    // - joystickX moves along camera's right axis
    // - joystickZ moves along camera's forward axis
    const worldDeltaX = joystickX * cameraRight.x + joystickZ * cameraDir.x;
    const worldDeltaZ = joystickX * cameraRight.z + joystickZ * cameraDir.z;

    dispatch({ type: 'MOVE_BOX', deltaX: worldDeltaX, deltaZ: worldDeltaZ });
  }, [dispatch]);

  const handleConfirmHeight = useCallback(() => {
    dispatch({ type: 'CONFIRM_HEIGHT' });
  }, [dispatch]);

  const handleSetStabilityMode = useCallback((mode: StabilityMode) => {
    setStabilityMode(mode);
    if (stabilizerRef.current) {
      stabilizerRef.current.setMode(mode);
    }
  }, []);

  const handleFindStorage = useCallback(() => {
    if (context.dragStart && context.dragEnd) {
      // Always use width/depth/height from state
      const data = calculateMeasurementsFromLLM(
        context.dragStart,
        context.width_m,
        context.depth_m,
        context.height_m,
        context.llmEstimate?.confidence || 'MEDIUM'
      );

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
        stabilityMode={stabilityMode}
        onUndo={handleUndo}
        onReset={handleReset}
        onSetWidth={handleSetWidth}
        onSetDepth={handleSetDepth}
        onSetHeight={handleSetHeight}
        onSetRotation={handleSetRotation}
        onMoveBox={handleMoveBox}
        onConfirmHeight={handleConfirmHeight}
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
