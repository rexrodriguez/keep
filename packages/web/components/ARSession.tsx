'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, onSessionEnd, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor } from '@/lib/three/reticle';
import { createTargetMarker, updateTargetMarker, disposeTargetMarker } from '@/lib/three/target-marker';
import { updateBoundingBox, disposeBoundingBox, addRotationGuide, removeRotationGuide, setTutorialHighlight } from '@/lib/three/bounding-box';
import { addBaseGrid, removeBaseGrid } from '@/lib/three/base-grid';
import TutorialOverlay, { TutorialStep } from './TutorialOverlay';
import ModeSelector from './ModeSelector';

// Control modes for box manipulation
export type ControlMode = 'move' | 'rotate' | 'resize';
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
import { captureXRCameraImage } from '@/lib/webxr/camera-capture';
import MeasurementUI from './MeasurementUI';

interface ARSessionProps {
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onExit: () => void;
  onFindStorage: (measurements: MeasurementData) => void;
  tutorialEnabled?: boolean;
}

export default function ARSession({ overlayRef, onExit, onFindStorage, tutorialEnabled = false }: ARSessionProps) {
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
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(tutorialEnabled ? 'surface' : 'complete');
  const [controlMode, setControlMode] = useState<ControlMode>('move');
  const [maskOverlay, setMaskOverlay] = useState<string | null>(null);

  // Current hit position for drag capture
  const currentHitRef = useRef<{ position: THREE.Vector3; stability: number } | null>(null);
  // Cache last valid hit for continuous dragging (Option 3: Aggressive caching)
  const lastValidHitRef = useRef<{ position: THREE.Vector3; stability: number; timestamp: number } | null>(null);
  // Store latest frame for camera capture
  const currentFrameRef = useRef<XRFrame | null>(null);
  // Trigger camera capture + AI estimation on next render frame.
  // Carries the tap point plus geometric context captured at tap time.
  const needCaptureRef = useRef<{
    point: MeasurementPoint;
    baseHitMatrix: number[] | null;
    basePosition: THREE.Vector3 | null;
  } | null>(null);
  // Screen-space pixel of last tap (for JPEG-space mapping)
  const tapScreenPxRef = useRef<{ x: number; y: number } | null>(null);
  // Raw hit-test pose matrix from the last valid hit (col-major Float32Array)
  const currentHitMatrixRef = useRef<Float32Array>(new Float32Array(16));
  // Track touch gesture state
  const isTouchingRef = useRef(false);
  const touchStartRef = useRef<{ time: number; position: THREE.Vector3 } | null>(null);
  const hasDraggedRef = useRef(false);
  // Track last warning to avoid calling setState every frame
  const lastTrackingWarningRef = useRef<string | null>(null);
  // Track last reticle color to avoid traversing group every frame
  const lastReticleStableRef = useRef<boolean | null>(null);
  // Frame counter (used for debug interval)
  const frameCountRef = useRef(0);

  // Active handle tracking for direct manipulation
  const activeHandleRef = useRef<{
    type: HandleType;
    data: HandleHitResult;
    startWorldPos: THREE.Vector3;
    startScreenPos: { x: number; y: number };
    startDimension: number;
    startRotation: number;
    lastDelta: number; // Track previous delta for incremental offset calculation
  } | null>(null);

  // Track if we're currently manipulating a handle
  const [isManipulating, setIsManipulating] = useState(false);

  const dispatch = useCallback((action: StateAction) => {
    setContext((prev) => stateMachineReducer(prev, action));
  }, []);

  // Initialize AR session
  useEffect(() => {
    let mounted = true;
    let sessionEndCleanup: (() => void) | null = null;
    let debugInterval: ReturnType<typeof setInterval> | null = null;

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

        // Listen for unexpected session end (e.g., device sleep, browser tab switch)
        const removeEndListener = onSessionEnd(xrCtx.session, () => {
          console.warn('XR session ended unexpectedly');
          if (renderLoopRef.current) {
            renderLoopRef.current.stop();
          }
          if (mounted) {
            onExit();
          }
        });

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

        // Store cleanup for end listener
        sessionEndCleanup = removeEndListener;

        // Debug: log frame rate every second
        debugInterval = setInterval(() => {
          if (mounted) {
            const fps = frameCountRef.current;
            frameCountRef.current = 0;
            console.debug(`AR fps:${fps}`);
          }
        }, 1000);
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
      if (sessionEndCleanup) sessionEndCleanup();
      if (debugInterval) clearInterval(debugInterval);
      cleanup();
    };
  }, [dispatch, overlayRef, onExit]);

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

  // Show/hide base plane grid
  useEffect(() => {
    if (!sceneContextRef.current) return;
    if (context.basePosition) {
      addBaseGrid(sceneContextRef.current.scene, context.basePosition);
    } else {
      removeBaseGrid(sceneContextRef.current.scene);
    }
  }, [context.basePosition]);

  // Calculate hitbox scale factor based on screen size
  // Larger screens need larger hitboxes for easier touch targeting
  // Baseline: iPhone 13 width (~390px) = 1.0, larger screens scale up
  const getHitScaleFactor = useCallback(() => {
    const baselineWidth = 390; // iPhone 13 width
    const screenWidth = window.innerWidth;
    // Scale up for larger screens, minimum 1.0, cap at 1.8
    return Math.min(1.8, Math.max(1.0, screenWidth / baselineWidth));
  }, []);

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
          context.rotation_deg,
          getHitScaleFactor(),
          controlMode
        );
      } else {
        disposeBoundingBox(sceneContextRef.current.scene);
      }
    }
  }, [context.dragStart, context.dragEnd, context.height_m, context.width_m, context.depth_m, context.rotation_deg, getHitScaleFactor, controlMode]);

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

    // Debug: count frames
    frameCountRef.current++;

    // Store frame for camera capture
    currentFrameRef.current = frame;

    // Camera capture for AI estimation (must happen during valid XR frame)
    if (needCaptureRef.current) {
      const { point: tapPoint, baseHitMatrix, basePosition } = needCaptureRef.current;
      needCaptureRef.current = null;

      const xrCtx = xrContextRef.current;
      if (xrCtx) {
        // Snapshot view matrices and compute JPEG-space tap pixel inside the valid XR frame
        const viewMatrixC2W = data.view ? Array.from(data.view.transform.matrix) : null;
        const projMatrix    = data.view ? Array.from(data.view.projectionMatrix)  : null;
        const camW = (data.view as any)?.camera?.width  ?? 1920;
        const camH = (data.view as any)?.camera?.height ?? 1080;
        const jpegW = Math.min(camW, 800);
        const jpegH = Math.round(camH * (jpegW / camW));
        const tapPx = tapScreenPxRef.current;
        const tapPixel = tapPx
          ? { x: tapPx.x * (jpegW / window.innerWidth), y: tapPx.y * (jpegH / window.innerHeight) }
          : { x: jpegW / 2, y: jpegH / 2 };

        captureXRCameraImage(xrCtx.renderer, xrCtx.glBinding, frame, xrCtx.localFloorSpace)
          .then(async (imageBase64) => {
            if (!imageBase64) throw new Error('Camera capture failed');

            const enrichedPayload = {
              imageJpegBase64: imageBase64.replace(/^data:image\/jpeg;base64,/, ''),
              imageSize: { width: jpegW, height: jpegH },
              camera: {
                viewMatrix_c2w_colMajor: viewMatrixC2W,
                projectionMatrix_colMajor: projMatrix,
              },
              plane: {
                hitMatrix_colMajor: baseHitMatrix,
                normal_world: [0, 1, 0],
                point_world: basePosition
                  ? [basePosition.x, basePosition.y, basePosition.z]
                  : [0, 0, 0],
              },
              selection: { type: 'tap', pixel: tapPixel },
            };

            const response = await fetch('/api/estimate-dimensions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(enrichedPayload),
            });
            const data = await response.json();

            // Show SAM mask overlay if available (debug visualization)
            if (data.maskImageBase64) {
              setMaskOverlay(`data:image/jpeg;base64,${data.maskImageBase64}`);
              setTimeout(() => setMaskOverlay(null), 5000);
            }

            if (data.success && data.estimate) {
              dispatch({ type: 'LLM_ESTIMATE_COMPLETE', estimate: data.estimate, point: tapPoint });
            } else {
              throw new Error(data.error || 'Estimation failed');
            }
          })
          .catch((error) => {
            console.warn('AI estimation failed, placing default box:', error);
            dispatch({ type: 'LLM_ESTIMATE_FAILED', error: error.message });
            dispatch({ type: 'PLACE_BOX', point: tapPoint });
          });
      }
    }

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
      // Store the raw hit matrix for use at base-tap time
      currentHitMatrixRef.current = hitTest.rawMatrix;

      stabilizerRef.current.addFrame(hitTest.position);
      const stability = stabilizerRef.current.checkStability();

      // Update reticle color based on stability (only when changed)
      if (reticleRef.current && lastReticleStableRef.current !== stability.isStable) {
        lastReticleStableRef.current = stability.isStable;
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

      if (lastTrackingWarningRef.current !== null) {
        lastTrackingWarningRef.current = null;
        setTrackingWarning(null);
      }
    } else {
      currentHitRef.current = null;
      // Don't clear lastValidHitRef - keep it for dragging continuity
      if (lastTrackingWarningRef.current !== 'Point at a flat surface') {
        lastTrackingWarningRef.current = 'Point at a flat surface';
        setTrackingWarning('Point at a flat surface');
      }
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
      removeBaseGrid(sceneContextRef.current.scene);
      disposeBoundingBox(sceneContextRef.current.scene);
      disposeTargetMarker(sceneContextRef.current.scene);
      disposeScene(sceneContextRef.current);
    }
  }, []);

  // Handle browser back button - exit AR gracefully instead of navigating away
  useEffect(() => {
    // Push a state so we can intercept the back button
    window.history.pushState({ arSession: true }, '');

    const handlePopState = () => {
      // Exit AR session and return to landing page
      cleanup();
      onExit();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [cleanup, onExit]);

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

  // Handle touch start - mode-based controls
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't handle if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    const touch = e.touches[0];
    if (!touch) return;

    // In HEIGHT_INPUT state, handle based on control mode
    if (context.state === 'HEIGHT_INPUT' && sceneContextRef.current && context.dragStart && context.dragEnd) {
      const p1 = context.dragStart.position;
      const p2 = context.dragEnd.position;
      const floorY = Math.min(p1.y, p2.y);

      if (controlMode === 'move') {
        // Move mode: any touch starts a move operation
        const worldPos = raycastToFloorPlane(
          touch.clientX,
          touch.clientY,
          sceneContextRef.current.camera,
          window.innerWidth,
          window.innerHeight,
          floorY
        );

        if (worldPos) {
          activeHandleRef.current = {
            type: 'bottomFace',
            data: { type: 'bottomFace', worldPosition: worldPos } as HandleHitResult,
            startWorldPos: worldPos.clone(),
            startScreenPos: { x: touch.clientX, y: touch.clientY },
            startDimension: 0,
            startRotation: context.rotation_deg,
            lastDelta: 0,
          };
          setIsManipulating(true);
        }
        return;
      }

      if (controlMode === 'rotate') {
        // Rotate mode: any touch starts a rotation operation
        const worldPos = raycastToFloorPlane(
          touch.clientX,
          touch.clientY,
          sceneContextRef.current.camera,
          window.innerWidth,
          window.innerHeight,
          floorY
        );

        if (worldPos) {
          activeHandleRef.current = {
            type: 'cornerTop',
            data: { type: 'cornerTop', cornerIndex: 0, worldPosition: worldPos } as HandleHitResult,
            startWorldPos: worldPos.clone(),
            startScreenPos: { x: touch.clientX, y: touch.clientY },
            startDimension: 0,
            startRotation: context.rotation_deg,
            lastDelta: 0,
          };
          setIsManipulating(true);

          // Show rotation guide
          const centerX = (p1.x + p2.x) / 2;
          const centerZ = (p1.z + p2.z) / 2;
          const radius = Math.max(context.width_m, context.depth_m) * 0.7;
          addRotationGuide(sceneContextRef.current.scene, centerX, floorY, centerZ, radius);
        }
        return;
      }

      if (controlMode === 'resize') {
        // Resize mode: only edge and topFace handles work
        const handleHit = raycastHandles(
          touch.clientX,
          touch.clientY,
          sceneContextRef.current.camera,
          sceneContextRef.current.scene,
          window.innerWidth,
          window.innerHeight
        );

        // Only allow edge and topFace handles in resize mode
        if (handleHit && (handleHit.type === 'edge' || handleHit.type === 'topFace')) {
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
            lastDelta: 0,
          };

          setIsManipulating(true);
          highlightHandle(
            sceneContextRef.current.scene,
            handleHit.type,
            handleHit.edge || handleHit.cornerIndex?.toString()
          );
        }
        return;
      }
    }

    // READY_TO_DRAW or READY_TO_MEASURE — tap-to-place
    if (context.state !== 'READY_TO_DRAW' && context.state !== 'READY_TO_MEASURE') {
      return;
    }

    if (!currentHitRef.current) {
      return;
    }

    // Store screen pixel for JPEG-space mapping used in geometric payload
    tapScreenPxRef.current = { x: touch.clientX, y: touch.clientY };

    isTouchingRef.current = true;
    hasDraggedRef.current = false;
    touchStartRef.current = {
      time: Date.now(),
      position: currentHitRef.current.position.clone(),
    };
  }, [context.state, context.width_m, context.depth_m, context.height_m, context.rotation_deg, context.dragStart, context.dragEnd, controlMode]);

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

          // Calculate INCREMENTAL offset to keep opposite edge fixed
          // Only move by the change since last frame, not the total delta
          const incrementalDelta = delta - handle.lastDelta;
          handle.lastDelta = delta;

          const rotationRad = (context.rotation_deg * Math.PI) / 180;
          let offsetX = 0;
          let offsetZ = 0;

          if (handle.data.axis === 'width') {
            // Width is local X axis
            offsetX = Math.cos(rotationRad) * (incrementalDelta / 2) * handle.data.direction;
            offsetZ = -Math.sin(rotationRad) * (incrementalDelta / 2) * handle.data.direction;
            dispatch({ type: 'SET_WIDTH', width_m: newDimension });
          } else {
            // Depth is local Z axis
            offsetX = Math.sin(rotationRad) * (incrementalDelta / 2) * handle.data.direction;
            offsetZ = Math.cos(rotationRad) * (incrementalDelta / 2) * handle.data.direction;
            dispatch({ type: 'SET_DEPTH', depth_m: newDimension });
          }

          // Move the box center to keep opposite edge fixed
          if (Math.abs(offsetX) > 0.0001 || Math.abs(offsetZ) > 0.0001) {
            dispatch({ type: 'MOVE_BOX', deltaX: offsetX, deltaZ: offsetZ });
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
      const manipulatedHandleType = activeHandleRef.current.type;

      // Remove rotation guide if it was shown (only for upper corners)
      if (manipulatedHandleType === 'cornerTop') {
        removeRotationGuide(sceneContextRef.current.scene);
      }

      unhighlightAllHandles(sceneContextRef.current.scene);
      activeHandleRef.current = null;
      setIsManipulating(false);

      // Auto-advance tutorial when user interacts in the matching mode
      if (tutorialEnabled) {
        setTutorialStep((prev) => {
          // Check if the current control mode matches the tutorial step
          if (prev === 'move' && controlMode === 'move') {
            return 'rotate';
          }
          if (prev === 'rotate' && controlMode === 'rotate') {
            return 'resize';
          }
          if (prev === 'resize' && controlMode === 'resize') {
            return 'done';
          }
          return prev;
        });
      }

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

    // Step 1: READY_TO_DRAW — tap sets the base plane
    if (context.state === 'READY_TO_DRAW') {
      const tapPosition = touchStart.position.clone();
      const stability = currentHitRef.current?.stability || 0.5;
      const point: MeasurementPoint = {
        position: tapPosition,
        timestamp: Date.now(),
        stability,
      };
      dispatch({
        type: 'SET_BASE',
        point,
        hitMatrix: Array.from(currentHitMatrixRef.current),
      });
      return;
    }

    // Step 2: READY_TO_MEASURE — tap triggers AI estimation (or default box)
    if (context.state === 'READY_TO_MEASURE' && !context.isEstimating) {
      const tapPosition = touchStart.position.clone();
      const stability = currentHitRef.current?.stability || 0.5;
      const point: MeasurementPoint = {
        position: tapPosition,
        timestamp: Date.now(),
        stability,
      };

      // Try AI estimation if camera access is available
      const xrCtx = xrContextRef.current;
      if (xrCtx?.hasCameraAccess) {
        dispatch({ type: 'START_LLM_ESTIMATE' });
        needCaptureRef.current = {
          point,
          baseHitMatrix: context.baseHitMatrix,
          basePosition: context.basePosition,
        };
        return;
      }

      // No camera access — place default box on base plane
      dispatch({ type: 'PLACE_BOX', point });
      return;
    }
  }, [context.state, context.isEstimating, context.baseHitMatrix, context.basePosition, dispatch, controlMode, tutorialEnabled]);

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

  // Tutorial handlers
  const handleTutorialNext = useCallback(() => {
    setTutorialStep((prev) => {
      const steps: TutorialStep[] = ['surface', 'move', 'rotate', 'resize', 'done', 'complete'];
      const currentIndex = steps.indexOf(prev);
      return steps[Math.min(currentIndex + 1, steps.length - 1)];
    });
  }, []);

  const handleTutorialSkip = useCallback(() => {
    setTutorialStep('complete');
  }, []);

  // Auto-advance tutorial from 'surface' to 'move' when box is placed
  useEffect(() => {
    if (tutorialStep === 'surface' && context.dragStart && context.dragEnd) {
      // Small delay so user can see the box appear
      const timer = setTimeout(() => setTutorialStep('move'), 500);
      return () => clearTimeout(timer);
    }
  }, [tutorialStep, context.dragStart, context.dragEnd]);

  // Update tutorial highlighting when step changes
  // With mode-based controls, only highlight resize handles when on resize step
  useEffect(() => {
    if (!sceneContextRef.current) return;

    // Only highlight resize handles during resize tutorial step
    const shouldHighlight = tutorialStep === 'resize' ? 'resize' : null;
    setTutorialHighlight(sceneContextRef.current.scene, shouldHighlight);
  }, [tutorialStep]);

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
        onReset={handleReset}
        onConfirmHeight={handleConfirmHeight}
        onFindStorage={handleFindStorage}
        onSetStabilityMode={handleSetStabilityMode}
        onExit={handleExit}
      />

      {/* Mode selector - show when box is placed */}
      {context.state === 'HEIGHT_INPUT' && (
        <ModeSelector mode={controlMode} onModeChange={setControlMode} />
      )}

      {/* Tutorial overlay */}
      {tutorialStep !== 'complete' && (
        <TutorialOverlay
          step={tutorialStep}
          onNext={handleTutorialNext}
          onSkip={handleTutorialSkip}
        />
      )}

      {/* SAM mask debug overlay — fades out after 5s */}
      {maskOverlay && (
        <div
          className="fixed inset-0 pointer-events-none flex items-center justify-center z-50 mask-overlay"
        >
          <img
            src={maskOverlay}
            alt="SAM mask"
            className="max-w-[80%] max-h-[60%] rounded-xl border-2 border-green-400/60 shadow-lg"
            style={{ objectFit: 'contain', opacity: 0.85 }}
          />
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 rounded-full px-4 py-1">
            <span className="text-green-400 text-xs font-medium">SAM Object Mask</span>
          </div>
        </div>
      )}

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
