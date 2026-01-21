'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor } from '@/lib/three/reticle';
import { createTargetMarker, updateTargetMarker, disposeTargetMarker } from '@/lib/three/target-marker';
import { updateBoundingBox, disposeBoundingBox, addRotationGuide, removeRotationGuide } from '@/lib/three/bounding-box';
import {
  raycastHandles,
  raycastToFloorPlane,
  highlightHandle,
  unhighlightAllHandles,
  calculateAxisDelta,
  screenDeltaToWorldHeight,
  calculateRotationFromCornerDrag,
  worldToScreen,
  HandleHitResult,
  HandleType,
} from '@/lib/three/handle-raycasting';
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

  // Active handle tracking for direct manipulation
  const activeHandleRef = useRef<{
    type: HandleType;
    data: HandleHitResult;
    startWorldPos: THREE.Vector3;
    startScreenPos: { x: number; y: number };
    startDimension: number;
    startRotation: number;
  } | null>(null);

  // Track if we're currently manipulating a handle
  const [isManipulating, setIsManipulating] = useState(false);

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

  // Get box center in screen coordinates (for rotation calculation)
  const getBoxCenterScreen = useCallback((): { x: number; y: number } | null => {
    if (!sceneContextRef.current || !context.dragStart || !context.dragEnd) return null;

    const p1 = context.dragStart.position;
    const p2 = context.dragEnd.position;
    const centerX = (p1.x + p2.x) / 2;
    const centerY = Math.min(p1.y, p2.y) + context.height_m / 2;
    const centerZ = (p1.z + p2.z) / 2;

    const boxCenter = new THREE.Vector3(centerX, centerY, centerZ);
    return worldToScreen(
      boxCenter,
      sceneContextRef.current.camera,
      window.innerWidth,
      window.innerHeight
    );
  }, [context.dragStart, context.dragEnd, context.height_m]);

  // Handle touch start - check for handle hit or tap-to-place
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't handle if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    const touch = e.touches[0];
    if (!touch) return;

    // In HEIGHT_INPUT state, check for handle interaction first
    if (context.state === 'HEIGHT_INPUT' && sceneContextRef.current) {
      const handleHit = raycastHandles(
        touch.clientX,
        touch.clientY,
        sceneContextRef.current.camera,
        sceneContextRef.current.scene,
        window.innerWidth,
        window.innerHeight
      );

      if (handleHit) {
        // Determine which dimension we're starting with
        let startDimension = 0;
        if (handleHit.type === 'edge') {
          startDimension = handleHit.axis === 'width' ? context.width_m : context.depth_m;
        } else if (handleHit.type === 'topFace') {
          startDimension = context.height_m;
        }

        activeHandleRef.current = {
          type: handleHit.type,
          data: handleHit,
          startWorldPos: handleHit.worldPosition.clone(),
          startScreenPos: { x: touch.clientX, y: touch.clientY },
          startDimension,
          startRotation: context.rotation_deg,
        };

        setIsManipulating(true);

        // Highlight the active handle
        highlightHandle(
          sceneContextRef.current.scene,
          handleHit.type,
          handleHit.edge || handleHit.cornerIndex?.toString()
        );

        // If upper corner handle (rotation), show rotation guide
        if (handleHit.type === 'cornerTop' && context.dragStart && context.dragEnd) {
          const p1 = context.dragStart.position;
          const p2 = context.dragEnd.position;
          const centerX = (p1.x + p2.x) / 2;
          const floorY = Math.min(p1.y, p2.y);
          const centerZ = (p1.z + p2.z) / 2;
          const radius = Math.max(context.width_m, context.depth_m) * 0.7;

          addRotationGuide(sceneContextRef.current.scene, centerX, floorY, centerZ, radius);
        }

        return;
      }
    }

    // READY_TO_DRAW state - tap-to-place
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
  }, [context.state, context.width_m, context.depth_m, context.height_m, context.rotation_deg, context.dragStart, context.dragEnd]);

  // Handle touch move - update handle drag or box drawing
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    // Handle active manipulation
    if (activeHandleRef.current && sceneContextRef.current) {
      const handle = activeHandleRef.current;

      if (handle.type === 'edge') {
        // Edge drag - raycast to floor to get current world position
        const currentWorldPos = raycastToFloorPlane(
          touch.clientX,
          touch.clientY,
          sceneContextRef.current.camera,
          window.innerWidth,
          window.innerHeight,
          handle.startWorldPos.y
        );

        if (currentWorldPos && handle.data.axis && handle.data.direction !== undefined) {
          const delta = calculateAxisDelta(
            handle.startWorldPos,
            currentWorldPos,
            handle.data.axis,
            handle.data.direction,
            context.rotation_deg
          );

          const newDimension = Math.max(0.0254, Math.min(5.08, handle.startDimension + delta));

          if (handle.data.axis === 'width') {
            dispatch({ type: 'SET_WIDTH', width_m: newDimension });
          } else {
            dispatch({ type: 'SET_DEPTH', depth_m: newDimension });
          }
        }
      } else if (handle.type === 'topFace') {
        // Top face drag - map screen Y delta to height
        const deltaScreenY = handle.startScreenPos.y - touch.clientY; // Inverted: drag up = increase

        if (context.dragStart && context.dragEnd) {
          const p1 = context.dragStart.position;
          const p2 = context.dragEnd.position;
          const boxCenter = new THREE.Vector3(
            (p1.x + p2.x) / 2,
            Math.min(p1.y, p2.y) + context.height_m / 2,
            (p1.z + p2.z) / 2
          );

          const deltaMeters = screenDeltaToWorldHeight(
            deltaScreenY,
            sceneContextRef.current.camera,
            boxCenter
          );

          const newHeight = Math.max(0.0254, Math.min(5.08, handle.startDimension + deltaMeters));
          dispatch({ type: 'SET_HEIGHT', height_m: newHeight });
        }
      } else if (handle.type === 'bottomFace') {
        // Bottom face drag - move box position
        const currentWorldPos = raycastToFloorPlane(
          touch.clientX,
          touch.clientY,
          sceneContextRef.current.camera,
          window.innerWidth,
          window.innerHeight,
          handle.startWorldPos.y
        );

        if (currentWorldPos) {
          const deltaX = currentWorldPos.x - handle.startWorldPos.x;
          const deltaZ = currentWorldPos.z - handle.startWorldPos.z;

          // Update start position for continuous movement
          handle.startWorldPos.copy(currentWorldPos);

          dispatch({ type: 'MOVE_BOX', deltaX, deltaZ });
        }
      } else if (handle.type === 'cornerTop') {
        // Upper corner drag - calculate rotation using world-space floor projection
        const boxCenterScreen = getBoxCenterScreen();
        if (boxCenterScreen && context.dragStart && context.dragEnd) {
          const p1 = context.dragStart.position;
          const p2 = context.dragEnd.position;
          const boxCenterWorld = new THREE.Vector3(
            (p1.x + p2.x) / 2,
            Math.min(p1.y, p2.y),
            (p1.z + p2.z) / 2
          );
          const floorY = Math.min(p1.y, p2.y);

          const newRotation = calculateRotationFromCornerDrag(
            handle.startScreenPos,
            { x: touch.clientX, y: touch.clientY },
            boxCenterScreen,
            handle.startRotation,
            sceneContextRef.current.camera,
            boxCenterWorld,
            floorY
          );

          dispatch({ type: 'SET_ROTATION', rotation_deg: newRotation });
        }
      } else if (handle.type === 'cornerBottom') {
        // Lower corner drag - move box position (same as bottom face)
        const currentWorldPos = raycastToFloorPlane(
          touch.clientX,
          touch.clientY,
          sceneContextRef.current.camera,
          window.innerWidth,
          window.innerHeight,
          handle.startWorldPos.y
        );

        if (currentWorldPos) {
          const deltaX = currentWorldPos.x - handle.startWorldPos.x;
          const deltaZ = currentWorldPos.z - handle.startWorldPos.z;

          // Update start position for continuous movement
          handle.startWorldPos.copy(currentWorldPos);

          dispatch({ type: 'MOVE_BOX', deltaX, deltaZ });
        }
      }

      return;
    }

    // Original drag logic for DRAWING state
    if (!isTouchingRef.current) {
      return;
    }

    if (!touchStartRef.current) {
      return;
    }

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
  }, [context.state, context.rotation_deg, context.dragStart, context.dragEnd, context.height_m, dispatch, getBoxCenterScreen]);

  // Handle touch end - finish handle manipulation or tap-to-place
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // Don't handle if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    // End any active handle manipulation
    if (activeHandleRef.current && sceneContextRef.current) {
      // Remove rotation guide if it was shown (only for upper corners)
      if (activeHandleRef.current.type === 'cornerTop') {
        removeRotationGuide(sceneContextRef.current.scene);
      }

      unhighlightAllHandles(sceneContextRef.current.scene);
      activeHandleRef.current = null;
      setIsManipulating(false);
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
        isManipulating={isManipulating}
        onUndo={handleUndo}
        onReset={handleReset}
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
