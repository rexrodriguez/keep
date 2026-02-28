'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor, setReticleMode } from '@/lib/three/reticle';
import { createTargetMarker, updateTargetMarker, disposeTargetMarker } from '@/lib/three/target-marker';
import { addFloorGrid, disposeFloorGrid } from '@/lib/three/floor-grid';
import { updateBoundingBox, disposeBoundingBox, addRotationGuide, removeRotationGuide, setTutorialHighlight } from '@/lib/three/bounding-box';
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
import { MeasurementPoint, ComputedMeasurements, ConfidenceLevel, MeasuredItem } from '@/lib/types';
import { DepthData } from '@/lib/webxr/depth-sensing';
import { buildCloudFromDepth, fitQuantileBox } from '@/lib/measurement/depth-box-fitting';
import MeasurementUI from './MeasurementUI';

interface ARSessionProps {
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onExit: () => void;
  onAddItem: (item: MeasuredItem) => void;
  onDone: () => void;
  itemCount: number;
  tutorialEnabled?: boolean;
}

export default function ARSession({ overlayRef, onExit, onAddItem, onDone, itemCount, tutorialEnabled = false }: ARSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneContextRef = useRef<SceneContext | null>(null);
  const xrContextRef = useRef<XRSessionContext | null>(null);
  const reticleRef = useRef<THREE.Group | null>(null);
  const targetMarkerRef = useRef<THREE.Group | null>(null);
  const stabilizerRef = useRef<PoseStabilizer>(new PoseStabilizer());
  const renderLoopRef = useRef<{ start: () => void; stop: () => void; captureNextFrame: (cb: (dataUrl: string) => void) => void } | null>(null);

  const [context, setContext] = useState<StateMachineContext>(initialContext);
  const [measurements, setMeasurements] = useState<ComputedMeasurements | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const [stabilityMode, setStabilityMode] = useState<StabilityMode>('balanced');
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(tutorialEnabled ? 'surface' : 'complete');
  const [controlMode, setControlMode] = useState<ControlMode>('move');
  const [hasDepth, setHasDepth] = useState(false);
  const hasDepthRef = useRef(false);

  // Current hit position for drag capture
  const currentHitRef = useRef<{ position: THREE.Vector3; stability: number } | null>(null);
  // Cache last valid hit for continuous dragging (Option 3: Aggressive caching)
  const lastValidHitRef = useRef<{ position: THREE.Vector3; stability: number; timestamp: number } | null>(null);
  // Store latest frame for camera capture
  const currentFrameRef = useRef<XRFrame | null>(null);
  // Store latest depth data for depth-enhanced placement
  const currentDepthRef = useRef<DepthData | null>(null);
  // Cache viewer pose for use outside XR animation callback (XRFrame expires)
  const currentViewerPoseRef = useRef<XRViewerPose | null>(null);
  // Multi-frame depth accumulation refs
  const accumulatedCloudRef = useRef<THREE.Vector3[]>([]);
  const measureFrameCountRef = useRef(0);
  const measureStartTimeRef = useRef(0);
  const MEASURE_TIMEOUT_MS = 1000; // minimum accumulation window
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
    lastDelta: number; // Track previous delta for incremental offset calculation
  } | null>(null);

  // Track if we're currently manipulating a handle
  const [isManipulating, setIsManipulating] = useState(false);

  const dispatch = useCallback((action: StateAction) => {
    setContext((prev) => stateMachineReducer(prev, action));
  }, []);

  // Track latest context inside handleFrame (avoids stale closure with [] deps)
  const contextRef = useRef(context);
  contextRef.current = context;
  hasDepthRef.current = hasDepth;

  const handleFrame = useCallback((data: FrameData) => {
    const { hitTest, frame } = data;

    // Store frame and pose for camera capture / depth placement
    currentFrameRef.current = frame;
    currentDepthRef.current = data.depthData;
    currentViewerPoseRef.current = data.viewerPose;
    if (data.depthData && !hasDepthRef.current) {
      setHasDepth(true);
    }

    // Multi-frame depth accumulation (MEASURING state)
    const ctx = contextRef.current;
    if (ctx.state === 'MEASURING' && ctx.measuringTap) {
      const tap = ctx.measuringTap;
      const elapsed = Date.now() - measureStartTimeRef.current;

      if (data.depthData && data.viewerPose) {
        // Build cloud from this frame and accumulate
        try {
          const frameCloud = buildCloudFromDepth(
            data.depthData,
            tap.normX,
            tap.normY,
            data.viewerPose,
            tap.floorY
          );
          if (frameCloud && frameCloud.length > 0) {
            // Append new points, cap at 10000 total
            const cloud = accumulatedCloudRef.current;
            const remaining = 10000 - cloud.length;
            if (remaining > 0) {
              cloud.push(...frameCloud.slice(0, remaining));
            }
            measureFrameCountRef.current++;
          }
        } catch (err) {
          console.warn('Frame cloud build failed:', err);
        }

        // Always wait the full timeout so the user sees the measuring indicator.
        // Frame count is just for logging — time is the gate.
        const done = elapsed >= MEASURE_TIMEOUT_MS;
        if (done) {
          const cloud = accumulatedCloudRef.current;
          console.log(`Depth accumulation complete: ${cloud.length} pts from ${measureFrameCountRef.current} frames in ${elapsed}ms`);

          if (cloud.length >= 20) {
            // Compute tap world point for centering using the cloud's centroid
            // (more stable than single-frame unprojection)
            const tapWorld = (() => {
              const cx = cloud.reduce((s, p) => s + p.x, 0) / cloud.length;
              const cz = cloud.reduce((s, p) => s + p.z, 0) / cloud.length;
              const cy = cloud.reduce((s, p) => s + p.y, 0) / cloud.length;
              return new THREE.Vector3(cx, cy, cz);
            })();

            const boxResult = fitQuantileBox(cloud, tap.floorY, tapWorld);
            console.log('Multi-frame box result:', boxResult);

            const anchorPoint: MeasurementPoint = {
              position: new THREE.Vector3(
                boxResult.center.x - boxResult.width_m / 2,
                tap.floorY,
                boxResult.center.z - boxResult.depth_m / 2
              ),
              timestamp: Date.now(),
              stability: tap.stability,
            };
            const endPoint: MeasurementPoint = {
              position: new THREE.Vector3(
                boxResult.center.x + boxResult.width_m / 2,
                tap.floorY,
                boxResult.center.z + boxResult.depth_m / 2
              ),
              timestamp: Date.now(),
              stability: tap.stability,
            };
            dispatch({
              type: 'PLACE_DEPTH_BOX',
              dragStart: anchorPoint,
              dragEnd: endPoint,
              width_m: boxResult.width_m,
              depth_m: boxResult.depth_m,
              height_m: boxResult.height_m,
              rotation_deg: boxResult.rotation_deg,
              confidence: boxResult.confidence,
            });
          } else {
            // Not enough points accumulated — fallback
            console.warn('Too few accumulated points:', cloud.length);
            dispatch({ type: 'PLACE_BOX', point: { position: tap.fallbackPosition.clone(), timestamp: Date.now(), stability: tap.stability } });
          }

          // Reset accumulation state
          accumulatedCloudRef.current = [];
          measureFrameCountRef.current = 0;
        }
      } else if (elapsed >= MEASURE_TIMEOUT_MS) {
        // Timeout with no depth data — fallback
        console.warn('Measuring timed out with no depth data');
        dispatch({ type: 'PLACE_BOX', point: { position: tap.fallbackPosition.clone(), timestamp: Date.now(), stability: tap.stability } });
        accumulatedCloudRef.current = [];
        measureFrameCountRef.current = 0;
      }
    }

    // Update reticle — only show in READY_TO_DRAW and FLOOR_LOCKED states (not during MEASURING)
    const currentState = contextRef.current.state;
    const showReticle = hitTest.hasHit && (currentState === 'READY_TO_DRAW' || currentState === 'FLOOR_LOCKED');
    if (reticleRef.current) {
      updateReticle(
        reticleRef.current,
        hitTest.position,
        hitTest.quaternion,
        showReticle
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
  }, [dispatch]);

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
      disposeFloorGrid(sceneContextRef.current.scene);
      disposeScene(sceneContextRef.current);
    }
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
  }, [dispatch, overlayRef, handleFrame, cleanup]);

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

  // Switch reticle mode based on state
  useEffect(() => {
    if (reticleRef.current) {
      setReticleMode(
        reticleRef.current,
        (context.state === 'FLOOR_LOCKED' || context.state === 'MEASURING') ? 'targeting' : 'surface'
      );
    }
  }, [context.state]);

  // Floor grid lifecycle: add on FLOOR_LOCKED, remove on exit
  useEffect(() => {
    if (!sceneContextRef.current) return;

    if (context.state === 'FLOOR_LOCKED' && context.floorLockPoint && context.floorY !== null) {
      addFloorGrid(sceneContextRef.current.scene, context.floorLockPoint, context.floorY);
    } else if (context.state === 'READY_TO_DRAW') {
      // Grid removed when going back to READY_TO_DRAW (undo/reset)
      disposeFloorGrid(sceneContextRef.current.scene);
    }
  }, [context.state, context.floorLockPoint, context.floorY]);

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

    // READY_TO_DRAW or FLOOR_LOCKED state - tap-to-place / tap-to-measure
    if (context.state !== 'READY_TO_DRAW' && context.state !== 'FLOOR_LOCKED') {
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

    // Step 1: In READY_TO_DRAW state, tap locks the floor
    if (context.state === 'READY_TO_DRAW') {
      dispatch({
        type: 'LOCK_FLOOR',
        floorY: touchStart.position.y,
        position: touchStart.position.clone(),
      });
      return;
    }

    // Step 2: In FLOOR_LOCKED state, tap the object to measure it
    if (context.state === 'FLOOR_LOCKED') {
      const stability = currentHitRef.current?.stability || 0.5;
      const floorY = context.floorY ?? touchStart.position.y;

      if (hasDepth) {
        const lastTouch = e.changedTouches[0];
        if (lastTouch) {
          // Start multi-frame depth accumulation
          accumulatedCloudRef.current = [];
          measureFrameCountRef.current = 0;
          measureStartTimeRef.current = Date.now();
          dispatch({
            type: 'START_MEASURING',
            normX: lastTouch.clientX / window.innerWidth,
            normY: lastTouch.clientY / window.innerHeight,
            floorY,
            stability,
            fallbackPosition: touchStart.position.clone(),
          });
          return;
        }
      }

      // No depth available — place default box using locked floor Y
      const point: MeasurementPoint = {
        position: new THREE.Vector3(
          touchStart.position.x,
          floorY,
          touchStart.position.z
        ),
        timestamp: Date.now(),
        stability,
      };
      dispatch({ type: 'PLACE_BOX', point });
      return;
    }
  }, [context.state, context.floorY, dispatch, controlMode, tutorialEnabled, hasDepth]);

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

  const handleAddItem = useCallback(() => {
    if (context.dragStart && context.dragEnd) {
      const itemData = {
        width_m: context.width_m,
        depth_m: context.depth_m,
        height_m: context.height_m,
        confidence: context.llmEstimate?.confidence || 'MEDIUM' as const,
      };

      // Capture thumbnail from next rendered frame, then create item
      const createItem = (thumbnail: string) => {
        const item: MeasuredItem = {
          id: crypto.randomUUID(),
          ...itemData,
          thumbnail,
          addedAt: Date.now(),
        };
        onAddItem(item);
        dispatch({ type: 'RESET' });
      };

      if (renderLoopRef.current) {
        renderLoopRef.current.captureNextFrame((dataUrl) => {
          createItem(dataUrl);
        });
      } else {
        // Fallback: no thumbnail
        createItem('');
      }
    }
  }, [context.dragStart, context.dragEnd, context.width_m, context.depth_m, context.height_m, context.llmEstimate, onAddItem, dispatch]);

  const handleDone = useCallback(() => {
    try { cleanup(); } catch (e) { console.error('Cleanup error:', e); }
    dispatch({ type: 'END_SESSION' });
    onDone();
  }, [cleanup, dispatch, onDone]);

  const handleExit = useCallback(() => {
    try { cleanup(); } catch (e) { console.error('Cleanup error:', e); }
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
        hasDepth={hasDepth}
        onReset={handleReset}
        onConfirmHeight={handleConfirmHeight}
        onAddItem={handleAddItem}
        onDone={handleDone}
        itemCount={itemCount}
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
