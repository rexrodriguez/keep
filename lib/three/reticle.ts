import * as THREE from 'three';

/**
 * Create a reticle mesh for indicating hit-test position
 */
export function createReticle(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'reticle';
  group.visible = false;

  // Outer ring
  const outerGeometry = new THREE.RingGeometry(0.08, 0.1, 32);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
  outerRing.rotation.x = -Math.PI / 2;
  group.add(outerRing);

  // Inner dot
  const innerGeometry = new THREE.CircleGeometry(0.02, 16);
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
  });
  const innerDot = new THREE.Mesh(innerGeometry, innerMaterial);
  innerDot.rotation.x = -Math.PI / 2;
  innerDot.position.y = 0.001; // Slight offset to prevent z-fighting
  group.add(innerDot);

  // Cross lines for precision
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });

  // Horizontal line
  const hPoints = [
    new THREE.Vector3(-0.06, 0, 0),
    new THREE.Vector3(-0.03, 0, 0),
    new THREE.Vector3(0.03, 0, 0),
    new THREE.Vector3(0.06, 0, 0),
  ];
  const hGeometry = new THREE.BufferGeometry().setFromPoints([hPoints[0], hPoints[1]]);
  const hLine1 = new THREE.Line(hGeometry, lineMaterial);
  group.add(hLine1);
  const hGeometry2 = new THREE.BufferGeometry().setFromPoints([hPoints[2], hPoints[3]]);
  const hLine2 = new THREE.Line(hGeometry2, lineMaterial);
  group.add(hLine2);

  // Vertical line
  const vPoints = [
    new THREE.Vector3(0, 0, -0.06),
    new THREE.Vector3(0, 0, -0.03),
    new THREE.Vector3(0, 0, 0.03),
    new THREE.Vector3(0, 0, 0.06),
  ];
  const vGeometry = new THREE.BufferGeometry().setFromPoints([vPoints[0], vPoints[1]]);
  const vLine1 = new THREE.Line(vGeometry, lineMaterial);
  group.add(vLine1);
  const vGeometry2 = new THREE.BufferGeometry().setFromPoints([vPoints[2], vPoints[3]]);
  const vLine2 = new THREE.Line(vGeometry2, lineMaterial);
  group.add(vLine2);

  return group;
}

/**
 * Update reticle position and orientation
 */
export function updateReticle(
  reticle: THREE.Group,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  visible: boolean
): void {
  reticle.visible = visible;

  if (visible) {
    reticle.position.copy(position);
    reticle.quaternion.copy(quaternion);
  }
}

/**
 * Set reticle color based on stability
 */
export function setReticleColor(reticle: THREE.Group, isStable: boolean): void {
  const color = isStable ? 0x00ff00 : 0xffaa00; // Green if stable, orange if not

  reticle.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      (child.material as THREE.MeshBasicMaterial).color.setHex(color);
    } else if (child instanceof THREE.Line) {
      (child.material as THREE.LineBasicMaterial).color.setHex(color);
    }
  });
}
