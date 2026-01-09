'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor } from '@/lib/three/reticle';
import { updateMarkersGroup } from '@/lib/three/markers';
import { updateBoundingBoxFromPoints } from '@/lib/three/bounding-box';
import { PoseStabilizer } from '@/lib/measurement/stabilization';
import {
  stateMachineReducer,
  initialContext,
  StateAction,
  canCapturePoint,
  StateMachineContext,
} from '@/lib/measurement/state-machine';
import {
  calculateMeasurements,
  calculatePartialMeasurements,
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
  const markersGroupRef = useRef<THREE.Group | null>(null);
  const stabilizerRef = useRef<PoseStabilizer>(new PoseStabilizer());
  const renderLoopRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  const [context, setContext] = useState<StateMachineContext>(initialContext);
  const [measurements, setMeasurements] = useState<Partial<ComputedMeasurements> | null>(null);
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

        // Create markers group
        const markersGroup = new THREE.Group();
        markersGroup.name = 'markers';
        sceneCtx.scene.add(markersGroup);
        markersGroupRef.current = markersGroup;

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

  // Update measurements when points change
  useEffect(() => {
    if (context.basePoints.length >= 2) {
      if (context.basePoints.length === 4 && context.heightPoint) {
        // Full measurements
        const data = calculateMeasurements(context.basePoints, context.heightPoint);
        if (data) {
          setMeasurements(toComputedMeasurements(data));
          setConfidence(data.confidence);
        }
      } else {
        // Partial measurements
        const partial = calculatePartialMeasurements(context.basePoints);
        setMeasurements(partial);
        setConfidence(null);
      }
    } else {
      setMeasurements(null);
      setConfidence(null);
    }

    // Update 3D markers
    if (markersGroupRef.current && sceneContextRef.current) {
      updateMarkersGroup(
        markersGroupRef.current,
        context.basePoints,
        context.heightPoint
      );

      // Update bounding box
      updateBoundingBoxFromPoints(
        sceneContextRef.current.scene,
        context.basePoints,
        context.heightPoint
      );
    }
  }, [context.basePoints, context.heightPoint]);

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

    // Update stabilizer
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

      // Update tracking warning
      setTrackingWarning(stability.message || null);
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
      disposeScene(sceneContextRef.current);
    }
  }, []);

  // Handle screen tap for point capture
  const handleTap = useCallback(() => {
    if (!canCapturePoint(context.state)) return;
    if (!currentHitRef.current) return;

    const stability = stabilizerRef.current.checkStability();
    if (!stability.isStable) {
      // Don't capture if unstable
      return;
    }

    const point: MeasurementPoint = {
      position: currentHitRef.current.position.clone(),
      timestamp: Date.now(),
      stability: currentHitRef.current.stability,
    };

    if (context.state === 'HEIGHT') {
      dispatch({ type: 'ADD_HEIGHT_POINT', point });
    } else {
      dispatch({ type: 'ADD_BASE_POINT', point });
    }
  }, [context.state, dispatch]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
    stabilizerRef.current.reset();
  }, [dispatch]);

  const handleFindStorage = useCallback(() => {
    const data = calculateMeasurements(context.basePoints, context.heightPoint);
    if (data) {
      onFindStorage(data);
    }
  }, [context.basePoints, context.heightPoint, onFindStorage]);

  const handleExit = useCallback(() => {
    cleanup();
    dispatch({ type: 'END_SESSION' });
    onExit();
  }, [cleanup, dispatch, onExit]);

  return (
    <>
      {/* Three.js container */}
      <div
        ref={containerRef}
        className="fixed inset-0"
        onClick={handleTap}
      />

      {/* Measurement UI overlay */}
      <MeasurementUI
        context={context}
        measurements={measurements}
        confidence={confidence}
        trackingWarning={trackingWarning}
        onUndo={handleUndo}
        onReset={handleReset}
        onFindStorage={handleFindStorage}
        onExit={handleExit}
      />

      {/* Tap hint (show when ready to capture) */}
      {canCapturePoint(context.state) && isReticleVisible && !trackingWarning && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
            <span className="text-white text-sm font-medium">Tap to place point</span>
          </div>
        </div>
      )}
    </>
  );
}
