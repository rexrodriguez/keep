import * as THREE from 'three';

const MARKER_NAME = 'target-marker';

/**
 * Create a target marker to show where the user tapped for LLM estimation
 * Uses a pulsing circle with crosshairs
 */
export function createTargetMarker(): THREE.Group {
  const group = new THREE.Group();
  group.name = MARKER_NAME;

  // Outer ring
  const outerGeometry = new THREE.RingGeometry(0.08, 0.1, 32);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x8b5cf6, // Purple
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
  outerRing.rotation.x = -Math.PI / 2;
  group.add(outerRing);

  // Inner filled circle
  const innerGeometry = new THREE.CircleGeometry(0.04, 32);
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xa78bfa, // Lighter purple
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7,
  });
  const innerCircle = new THREE.Mesh(innerGeometry, innerMaterial);
  innerCircle.rotation.x = -Math.PI / 2;
  innerCircle.position.y = 0.001; // Slightly above to prevent z-fighting
  group.add(innerCircle);

  // Vertical pole to make it more visible
  const poleGeometry = new THREE.CylinderGeometry(0.005, 0.005, 0.3, 8);
  const poleMaterial = new THREE.MeshBasicMaterial({
    color: 0x8b5cf6,
    transparent: true,
    opacity: 0.8,
  });
  const pole = new THREE.Mesh(poleGeometry, poleMaterial);
  pole.position.y = 0.15;
  group.add(pole);

  // Top sphere
  const sphereGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const sphereMaterial = new THREE.MeshBasicMaterial({
    color: 0xc4b5fd, // Even lighter purple
  });
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.position.y = 0.3;
  group.add(sphere);

  group.visible = false;
  return group;
}

/**
 * Update target marker position
 */
export function updateTargetMarker(
  marker: THREE.Group,
  position: THREE.Vector3 | null,
  visible: boolean
): void {
  if (!position || !visible) {
    marker.visible = false;
    return;
  }

  marker.position.copy(position);
  marker.visible = true;

  // Add subtle pulse animation via scale
  const time = Date.now() * 0.003;
  const scale = 1 + Math.sin(time) * 0.1;
  marker.scale.setScalar(scale);
}

/**
 * Find and remove target marker from scene
 */
export function disposeTargetMarker(scene: THREE.Scene): void {
  const marker = scene.getObjectByName(MARKER_NAME);
  if (marker) {
    scene.remove(marker);
    marker.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
