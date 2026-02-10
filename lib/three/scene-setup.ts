import * as THREE from 'three';

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cleanup: () => void;
}

/**
 * Create and configure Three.js scene for WebXR AR
 */
export function createARScene(container: HTMLElement): SceneContext {
  // Create scene
  const scene = new THREE.Scene();

  // Create camera (managed by WebXR, but needed for Three.js)
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );

  // Create renderer with WebXR support
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // Append canvas to container
  container.appendChild(renderer.domElement);

  // Add ambient light for visibility
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  // Add directional light for shadows/depth
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);

  // Handle resize
  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener('resize', handleResize);

  const cleanup = () => {
    window.removeEventListener('resize', handleResize);
  };

  return { scene, camera, renderer, cleanup };
}

/**
 * Dispose of scene resources
 */
export function disposeScene(context: SceneContext): void {
  // Remove resize listener
  context.cleanup();

  // Dispose all objects in scene
  context.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((m) => m.dispose());
      } else {
        object.material.dispose();
      }
    }
  });

  // Dispose renderer
  context.renderer.dispose();

  // Remove canvas from DOM
  if (context.renderer.domElement.parentElement) {
    context.renderer.domElement.parentElement.removeChild(context.renderer.domElement);
  }
}
