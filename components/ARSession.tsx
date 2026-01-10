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
  canCapturePoint,
  StateMachineContext,
} from '@/lib/measurement/state-machine';
import {
  calculateMeasurementsFromFloorPoints,
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
  const marker1Ref = useRef<THREE.Mesh | null>(null);
  const marker2Ref = useRef<THREE.Mesh | null>(null);
  const lineRef = useRef<THREE.Line | null>(null);
  const stabilizerRef = useRef<PoseStabilizer>(new PoseStabilizer());
  const renderLoopRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  const [context, setContext] = useState<StateMachineContext>(initialContext);
  const [measurements, setMeasurements] = useState<ComputedMeasurements | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceLevel | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const [isReticleVisible, setIsReticleVisible] = useState(false);

  // Current hit position for tap capture
  const currentHitRef = useRef<{ position: THREE.Vector3; stability: number } | null>(null);

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

        // Create markers for floor points (shown after taps)
        const markerGeometry = new THREE.SphereGeometry(0.02, 16, 16);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

        const marker1 = new THREE.Mesh(markerGeometry, markerMaterial);
        marker1.visible = false;
        sceneCtx.scene.add(marker1);
        marker1Ref.current = marker1;

        const marker2 = new THREE.Mesh(markerGeometry, markerMaterial.clone());
        marker2.visible = false;
        sceneCtx.scene.add(marker2);
        marker2Ref.current = marker2;

        // Create line between markers
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        const lineGeometry = new THREE.BufferGeometry();
        const line = new THREE.Line(lineGeometry, lineMaterial);
        line.visible = false;
        sceneCtx.scene.add(line);
        lineRef.current = line;

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

  // Update visuals when floor points change
  useEffect(() => {
    // Update first marker
    if (marker1Ref.current && context.floorPoint1) {
      marker1Ref.current.position.copy(context.floorPoint1.position);
      marker1Ref.current.visible = true;
    } else if (marker1Ref.current) {
      marker1Ref.current.visible = false;
    }

    // Update second marker
    if (marker2Ref.current && context.floorPoint2) {
      marker2Ref.current.position.copy(context.floorPoint2.position);
      marker2Ref.current.visible = true;
    } else if (marker2Ref.current) {
      marker2Ref.current.visible = false;
    }

    // Update line between markers
    if (lineRef.current && context.floorPoint1 && context.floorPoint2) {
      const positions = new Float32Array([
        context.floorPoint1.position.x, context.floorPoint1.position.y, context.floorPoint1.position.z,
        context.floorPoint2.position.x, context.floorPoint2.position.y, context.floorPoint2.position.z,
      ]);
      lineRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      lineRef.current.visible = true;
    } else if (lineRef.current) {
      lineRef.current.visible = false;
    }
  }, [context.floorPoint1, context.floorPoint2]);

  // Update bounding box when floor points or height change
  useEffect(() => {
    if (sceneContextRef.current) {
      // Show bounding box once we have both floor points (during HEIGHT_INPUT or REVIEW)
      const showBox = context.floorPoint1 && context.floorPoint2 &&
        (context.state === 'HEIGHT_INPUT' || context.state === 'REVIEW');

      if (showBox) {
        updateBoundingBox(
          sceneContextRef.current.scene,
          context.floorPoint1,
          context.floorPoint2,
          context.height_m
        );
      } else {
        disposeBoundingBox(sceneContextRef.current.scene);
      }
    }
  }, [context.floorPoint1, context.floorPoint2, context.height_m, context.state]);

  // Update measurements when height changes or in review
  useEffect(() => {
    if (context.floorPoint1 && context.floorPoint2) {
      const data = calculateMeasurementsFromFloorPoints(
        context.floorPoint1,
        context.floorPoint2,
        context.height_m
      );
      setMeasurements(toComputedMeasurements(data));
      setConfidence(data.confidence);
    } else {
      setMeasurements(null);
      setConfidence(null);
    }
  }, [context.floorPoint1, context.floorPoint2, context.height_m]);

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
      setIsReticleVisible(hitTest.hasHit);
    }

    // Update stabilizer and current hit
    if (hitTest.hasHit) {
      stabilizerRef.current.addFrame(hitTest.position);
      const stability = stabilizerRef.current.checkStability();

      // Update reticle color based on stability
      if (reticleRef.current) {
        setReticleColor(reticleRef.current, stability.isStable);
      }

      // Store current hit for tap capture
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

  // Handle screen tap for floor point capture
  const handleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    // Don't capture if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT') {
      return;
    }

    if (!canCapturePoint(context.state)) {
      return;
    }

    // Use current hit position if available
    if (!currentHitRef.current) {
      return;
    }

    const point: MeasurementPoint = {
      position: currentHitRef.current.position.clone(),
      timestamp: Date.now(),
      stability: currentHitRef.current.stability,
    };

    dispatch({ type: 'ADD_FLOOR_POINT', point });
  }, [context.state, dispatch]);

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
    if (context.floorPoint1 && context.floorPoint2) {
      const data = calculateMeasurementsFromFloorPoints(
        context.floorPoint1,
        context.floorPoint2,
        context.height_m
      );
      onFindStorage(data);
    }
  }, [context.floorPoint1, context.floorPoint2, context.height_m, onFindStorage]);

  const handleExit = useCallback(() => {
    cleanup();
    dispatch({ type: 'END_SESSION' });
    onExit();
  }, [cleanup, dispatch, onExit]);

  // Render UI into the overlay container via portal so it shows during AR
  const overlayContent = (
    <div
      className="fixed inset-0"
      onTouchEnd={handleTap}
      onClick={handleTap}
      style={{ touchAction: 'manipulation' }}
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

      {/* Tap hint (show when ready to capture floor points) */}
      {canCapturePoint(context.state) && isReticleVisible && !trackingWarning && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
            <span className="text-white text-sm font-medium">Tap to place point</span>
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
