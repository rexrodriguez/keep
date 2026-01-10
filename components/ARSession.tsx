'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { createARScene, disposeScene, SceneContext } from '@/lib/three/scene-setup';
import { startARSession, endARSession, XRSessionContext } from '@/lib/webxr/session-manager';
import { createRenderLoop, FrameData } from '@/lib/webxr/render-loop';
import { createReticle, updateReticle, setReticleColor } from '@/lib/three/reticle';
import { PoseStabilizer } from '@/lib/measurement/stabilization';
import {
  stateMachineReducer,
  initialContext,
  StateAction,
  canCapturePoint,
  StateMachineContext,
} from '@/lib/measurement/state-machine';
import {
  calculateMeasurementsFromCorners,
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

        // Create marker for first corner (shown after first tap) - small sphere
        const markerGeometry = new THREE.SphereGeometry(0.01, 16, 16);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const marker1 = new THREE.Mesh(markerGeometry, markerMaterial);
        marker1.visible = false;
        sceneCtx.scene.add(marker1);
        marker1Ref.current = marker1;

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

  // Update measurements and visuals when corners change
  useEffect(() => {
    // Update first marker visibility
    if (marker1Ref.current && context.corner1) {
      marker1Ref.current.position.copy(context.corner1.position);
      marker1Ref.current.visible = true;
    } else if (marker1Ref.current) {
      marker1Ref.current.visible = false;
    }

    // Calculate measurements when both corners are set
    if (context.corner1 && context.corner2) {
      const data = calculateMeasurementsFromCorners(context.corner1, context.corner2);
      setMeasurements(toComputedMeasurements(data));
      setConfidence(data.confidence);
    } else {
      setMeasurements(null);
      setConfidence(null);
    }
  }, [context.corner1, context.corner2]);

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
  const handleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    // Don't capture if tap was on a button or UI element
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button')) {
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

    dispatch({ type: 'ADD_CORNER', point });
  }, [context.state, dispatch]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, [dispatch]);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
    stabilizerRef.current.reset();
  }, [dispatch]);

  const handleFindStorage = useCallback(() => {
    if (context.corner1 && context.corner2) {
      const data = calculateMeasurementsFromCorners(context.corner1, context.corner2);
      onFindStorage(data);
    }
  }, [context.corner1, context.corner2, onFindStorage]);

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
      {/* Measurement UI overlay - renders on top but has pointer-events-none except for buttons */}
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
