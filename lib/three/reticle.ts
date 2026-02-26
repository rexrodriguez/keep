import * as THREE from 'three';

export type ReticleMode = 'surface' | 'targeting';

/**
 * Create a reticle mesh for indicating hit-test position.
 * Has two visual modes toggled by setReticleMode:
 * - 'surface' (default): green ring + dot + small cross lines (for floor detection)
 * - 'targeting': cyan crosshair with larger arms and center dot (for object targeting)
 */
export function createReticle(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'reticle';
  group.visible = false;

  // === Surface mode children (green ring + dot + cross) ===

  // Outer ring
  const outerGeometry = new THREE.RingGeometry(0.03, 0.04, 32);
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.userData.mode = 'surface';
  group.add(outerRing);

  // Inner dot
  const innerGeometry = new THREE.CircleGeometry(0.008, 16);
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
  });
  const innerDot = new THREE.Mesh(innerGeometry, innerMaterial);
  innerDot.rotation.x = -Math.PI / 2;
  innerDot.position.y = 0.001;
  innerDot.userData.mode = 'surface';
  group.add(innerDot);

  // Surface cross lines
  const surfaceLineMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });

  const hPoints = [
    new THREE.Vector3(-0.025, 0, 0),
    new THREE.Vector3(-0.012, 0, 0),
    new THREE.Vector3(0.012, 0, 0),
    new THREE.Vector3(0.025, 0, 0),
  ];
  const hLine1 = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([hPoints[0], hPoints[1]]),
    surfaceLineMat
  );
  hLine1.userData.mode = 'surface';
  group.add(hLine1);
  const hLine2 = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([hPoints[2], hPoints[3]]),
    surfaceLineMat
  );
  hLine2.userData.mode = 'surface';
  group.add(hLine2);

  const vPoints = [
    new THREE.Vector3(0, 0, -0.025),
    new THREE.Vector3(0, 0, -0.012),
    new THREE.Vector3(0, 0, 0.012),
    new THREE.Vector3(0, 0, 0.025),
  ];
  const vLine1 = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([vPoints[0], vPoints[1]]),
    surfaceLineMat
  );
  vLine1.userData.mode = 'surface';
  group.add(vLine1);
  const vLine2 = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([vPoints[2], vPoints[3]]),
    surfaceLineMat
  );
  vLine2.userData.mode = 'surface';
  group.add(vLine2);

  // === Targeting mode children (red crosshair) ===
  const TARGET_COLOR = 0xff2222;
  const ARM = 0.05;  // 5cm arms
  const GAP = 0.015; // 1.5cm center gap

  const targetLineMat = new THREE.LineBasicMaterial({ color: TARGET_COLOR, linewidth: 3 });

  // Horizontal arms
  const thLeft = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-ARM, 0, 0),
      new THREE.Vector3(-GAP, 0, 0),
    ]),
    targetLineMat
  );
  thLeft.userData.mode = 'targeting';
  thLeft.visible = false;
  group.add(thLeft);

  const thRight = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(GAP, 0, 0),
      new THREE.Vector3(ARM, 0, 0),
    ]),
    targetLineMat
  );
  thRight.userData.mode = 'targeting';
  thRight.visible = false;
  group.add(thRight);

  // Vertical arms (Z axis since reticle lies on XZ plane)
  const tvUp = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -ARM),
      new THREE.Vector3(0, 0, -GAP),
    ]),
    targetLineMat
  );
  tvUp.userData.mode = 'targeting';
  tvUp.visible = false;
  group.add(tvUp);

  const tvDown = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, GAP),
      new THREE.Vector3(0, 0, ARM),
    ]),
    targetLineMat
  );
  tvDown.userData.mode = 'targeting';
  tvDown.visible = false;
  group.add(tvDown);

  // Center dot for targeting
  const targetDotGeo = new THREE.CircleGeometry(0.005, 16);
  const targetDotMat = new THREE.MeshBasicMaterial({
    color: TARGET_COLOR,
    side: THREE.DoubleSide,
  });
  const targetDot = new THREE.Mesh(targetDotGeo, targetDotMat);
  targetDot.rotation.x = -Math.PI / 2;
  targetDot.position.y = 0.001;
  targetDot.userData.mode = 'targeting';
  targetDot.visible = false;
  group.add(targetDot);

  return group;
}

/**
 * Switch reticle between surface and targeting visual modes
 */
export function setReticleMode(reticle: THREE.Group, mode: ReticleMode): void {
  reticle.children.forEach((child) => {
    const childMode = child.userData.mode;
    if (childMode === 'surface') {
      child.visible = mode === 'surface';
    } else if (childMode === 'targeting') {
      child.visible = mode === 'targeting';
    }
  });
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
 * Set reticle color based on stability (only affects surface mode children)
 */
export function setReticleColor(reticle: THREE.Group, isStable: boolean): void {
  const color = isStable ? 0x00ff00 : 0xffaa00; // Green if stable, orange if not

  reticle.traverse((child) => {
    // Only recolor surface-mode children
    if (child.userData.mode !== 'surface') return;
    if (child instanceof THREE.Mesh) {
      (child.material as THREE.MeshBasicMaterial).color.setHex(color);
    } else if (child instanceof THREE.Line) {
      (child.material as THREE.LineBasicMaterial).color.setHex(color);
    }
  });
}
