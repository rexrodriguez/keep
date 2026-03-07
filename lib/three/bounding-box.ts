import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { MeasurementPoint } from '@/lib/types';

// Preload the logo texture once
const textureLoader = new THREE.TextureLoader();
let logoTexture: THREE.Texture | null = null;

// Load texture asynchronously
textureLoader.load('/keep.png', (texture) => {
  logoTexture = texture;
  logoTexture.colorSpace = THREE.SRGBColorSpace;
});

// Re-export handle types for external use
export type { HandleType, EdgeType, AxisType } from './handle-raycasting';

// Control mode type for visibility filtering
export type ControlMode = 'move' | 'rotate' | 'resize';

/**
 * Format meters to inches display string
 */
function formatInches(meters: number): string {
  const inches = Math.round(meters * 39.3701);
  return `${inches}"`;
}

/**
 * Create a text sprite (billboard) for dimension labels
 */
function createTextSprite(
  text: string,
  color: string = '#00ffff'
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;

  // High-res canvas for crisp text
  const fontSize = 48;
  canvas.width = 256;
  canvas.height = 64;

  // Background pill
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  const padding = 12;
  const textWidth = context.measureText(text).width || 100;
  context.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const actualTextWidth = context.measureText(text).width;
  const pillWidth = Math.min(actualTextWidth + padding * 2, canvas.width);
  const pillHeight = fontSize + padding;
  const pillX = (canvas.width - pillWidth) / 2;
  const pillY = (canvas.height - pillHeight) / 2;

  // Draw rounded rectangle
  const radius = pillHeight / 2;
  context.beginPath();
  context.moveTo(pillX + radius, pillY);
  context.lineTo(pillX + pillWidth - radius, pillY);
  context.arc(pillX + pillWidth - radius, pillY + radius, radius, -Math.PI / 2, Math.PI / 2);
  context.lineTo(pillX + radius, pillY + pillHeight);
  context.arc(pillX + radius, pillY + radius, radius, Math.PI / 2, -Math.PI / 2);
  context.closePath();
  context.fill();

  // Draw text
  context.fillStyle = color;
  context.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  // Create sprite
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,  // Always visible
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(spriteMaterial);
  // Scale sprite to reasonable size in world space (adjust based on canvas aspect)
  sprite.scale.set(0.15, 0.0375, 1);  // 256:64 aspect ratio

  return sprite;
}

/**
 * Add dimension labels to a box group
 * Width & Depth use cyan (footprint), Height uses purple (vertical)
 */
function addDimensionLabels(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  // Width label - on front edge at bottom (cyan - footprint)
  const widthLabel = createTextSprite(formatInches(width), '#22d3ee'); // cyan-400
  widthLabel.position.set(0, -height / 2, depth / 2 + 0.05);
  widthLabel.name = 'label-width';
  group.add(widthLabel);

  // Depth label - on right edge at bottom (cyan - footprint)
  const depthLabel = createTextSprite(formatInches(depth), '#22d3ee'); // cyan-400
  depthLabel.position.set(width / 2 + 0.05, -height / 2, 0);
  depthLabel.name = 'label-depth';
  group.add(depthLabel);

  // Height label - on front-right vertical edge (purple - vertical)
  const heightLabel = createTextSprite(formatInches(height), '#c084fc'); // purple-400
  heightLabel.position.set(width / 2 + 0.05, 0, depth / 2 + 0.05);
  heightLabel.name = 'label-height';
  group.add(heightLabel);
}

/**
 * Add black box edges with thicker lines using Line2
 * Uses straight edges (no rounding) for a cleaner look
 */
function addColoredEdges(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  // Define the 8 corners
  const corners = [
    new THREE.Vector3(-hw, -hh, -hd), // 0: bottom-back-left
    new THREE.Vector3(hw, -hh, -hd),  // 1: bottom-back-right
    new THREE.Vector3(hw, -hh, hd),   // 2: bottom-front-right
    new THREE.Vector3(-hw, -hh, hd),  // 3: bottom-front-left
    new THREE.Vector3(-hw, hh, -hd),  // 4: top-back-left
    new THREE.Vector3(hw, hh, -hd),   // 5: top-back-right
    new THREE.Vector3(hw, hh, hd),    // 6: top-front-right
    new THREE.Vector3(-hw, hh, hd),   // 7: top-front-left
  ];

  // All 12 edges of the box
  const edges: [number, number][] = [
    // Bottom face
    [0, 1], [1, 2], [2, 3], [3, 0],
    // Top face
    [4, 5], [5, 6], [6, 7], [7, 4],
    // Vertical edges
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  // Black solid line material with increased width
  const lineMaterial = new LineMaterial({
    color: 0x000000, // Black
    linewidth: 3, // In pixels
    transparent: true,
    opacity: 0.85,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
  });

  // Create each edge as a separate Line2 for proper thick rendering
  for (const [a, b] of edges) {
    const positions: number[] = [
      corners[a].x, corners[a].y, corners[a].z,
      corners[b].x, corners[b].y, corners[b].z,
    ];

    const lineGeometry = new LineGeometry();
    lineGeometry.setPositions(positions);

    const line = new Line2(lineGeometry, lineMaterial.clone());
    line.computeLineDistances();
    line.name = 'box-edge';
    group.add(line);
  }
}

/**
 * Create a soft contact shadow texture using canvas
 * Creates a radial gradient that fades from dark center to transparent edges
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;

  // Create radial gradient - dark center fading to transparent
  const gradient = context.createRadialGradient(
    size / 2, size / 2, 0,           // Inner circle (center)
    size / 2, size / 2, size / 2     // Outer circle (edges)
  );

  // Soft shadow gradient stops
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.35)');     // Center - darker
  gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.25)');   // Mid
  gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.1)');    // Fade
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');        // Edge - transparent

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Add a contact shadow (floor footprint) under the box
 * This grounds the box visually and makes it feel more "real"
 */
function addContactShadow(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  // Create shadow plane slightly larger than the box footprint
  const shadowPadding = 0.08; // 8cm padding for soft edge
  const shadowWidth = width + shadowPadding * 2;
  const shadowDepth = depth + shadowPadding * 2;

  const shadowGeometry = new THREE.PlaneGeometry(shadowWidth, shadowDepth);
  const shadowTexture = createContactShadowTexture();

  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);

  // Position at floor level (bottom of box), rotated to lie flat
  shadowMesh.rotation.x = -Math.PI / 2; // Rotate to horizontal
  shadowMesh.position.set(0, -height / 2 + 0.001, 0); // Slightly above floor to prevent z-fighting
  shadowMesh.name = 'contact-shadow';

  // Render shadow before (behind) other objects
  shadowMesh.renderOrder = -1;

  group.add(shadowMesh);
}

/**
 * Add subtle glow where box edges meet the floor
 * Creates a grounding effect that makes the box feel connected to the surface
 */
function addFloorEdgeGlow(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  const floorY = -height / 2 + 0.002;
  const glowWidth = 0.015; // 1.5cm glow width

  // Create glow texture
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext('2d')!;

  // Gradient from cyan center to transparent edges
  const gradient = ctx.createLinearGradient(0, 0, 0, 8);
  gradient.addColorStop(0, 'rgba(0, 255, 255, 0)');
  gradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;

  const glowMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Front edge glow
  const frontGlowGeom = new THREE.PlaneGeometry(width, glowWidth);
  const frontGlow = new THREE.Mesh(frontGlowGeom, glowMaterial);
  frontGlow.rotation.x = -Math.PI / 2;
  frontGlow.position.set(0, floorY, depth / 2 + glowWidth / 2);
  frontGlow.name = 'floor-glow-front';
  group.add(frontGlow);

  // Back edge glow
  const backGlow = new THREE.Mesh(frontGlowGeom.clone(), glowMaterial);
  backGlow.rotation.x = -Math.PI / 2;
  backGlow.position.set(0, floorY, -depth / 2 - glowWidth / 2);
  backGlow.name = 'floor-glow-back';
  group.add(backGlow);

  // Left edge glow
  const sideGlowGeom = new THREE.PlaneGeometry(depth, glowWidth);
  const leftGlow = new THREE.Mesh(sideGlowGeom, glowMaterial);
  leftGlow.rotation.x = -Math.PI / 2;
  leftGlow.rotation.z = Math.PI / 2;
  leftGlow.position.set(-width / 2 - glowWidth / 2, floorY, 0);
  leftGlow.name = 'floor-glow-left';
  group.add(leftGlow);

  // Right edge glow
  const rightGlow = new THREE.Mesh(sideGlowGeom.clone(), glowMaterial);
  rightGlow.rotation.x = -Math.PI / 2;
  rightGlow.rotation.z = Math.PI / 2;
  rightGlow.position.set(width / 2 + glowWidth / 2, floorY, 0);
  rightGlow.name = 'floor-glow-right';
  group.add(rightGlow);
}

/**
 * Add scale reference ticks on the floor near the box
 * Shows 1-foot ruler marks to help users trust the AR scale
 */
function addScaleReference(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  const ONE_FOOT = 0.3048; // 1 foot in meters
  const floorY = -height / 2 + 0.002; // Slightly above shadow

  // Create tick mark geometry (small vertical line on floor)
  const createTick = (length: number = 0.02): THREE.Line => {
    const points = [
      new THREE.Vector3(0, 0, -length / 2),
      new THREE.Vector3(0, 0, length / 2),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
    });
    return new THREE.Line(geometry, material);
  };

  // Create "1 ft" label sprite
  const createFootLabel = (): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 64;
    canvas.height = 32;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = 'bold 18px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1 ft', 32, 16);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.08, 0.04, 1);
    return sprite;
  };

  // Place ruler along the front edge (width direction) if box is wide enough
  if (width >= ONE_FOOT * 0.8) {
    const rulerGroup = new THREE.Group();
    rulerGroup.name = 'scale-ruler-width';

    // Start tick
    const startTick = createTick(0.03);
    startTick.position.set(-width / 2 - 0.05, 0, 0);
    rulerGroup.add(startTick);

    // End tick (1 foot from start)
    const endTick = createTick(0.03);
    endTick.position.set(-width / 2 - 0.05 + ONE_FOOT, 0, 0);
    rulerGroup.add(endTick);

    // Connecting line
    const linePoints = [
      new THREE.Vector3(-width / 2 - 0.05, 0, 0),
      new THREE.Vector3(-width / 2 - 0.05 + ONE_FOOT, 0, 0),
    ];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    rulerGroup.add(line);

    // Label
    const label = createFootLabel();
    label.position.set(-width / 2 - 0.05 + ONE_FOOT / 2, 0.02, 0);
    rulerGroup.add(label);

    // Position ruler on floor, along front edge
    rulerGroup.position.set(0, floorY, depth / 2 + 0.08);
    group.add(rulerGroup);
  }

  // Place ruler along the right edge (depth direction) if box is deep enough
  if (depth >= ONE_FOOT * 0.8) {
    const rulerGroup = new THREE.Group();
    rulerGroup.name = 'scale-ruler-depth';

    // Start tick
    const startTick = createTick(0.03);
    startTick.rotation.y = Math.PI / 2;
    startTick.position.set(0, 0, -depth / 2 - 0.05);
    rulerGroup.add(startTick);

    // End tick (1 foot from start)
    const endTick = createTick(0.03);
    endTick.rotation.y = Math.PI / 2;
    endTick.position.set(0, 0, -depth / 2 - 0.05 + ONE_FOOT);
    rulerGroup.add(endTick);

    // Connecting line
    const linePoints = [
      new THREE.Vector3(0, 0, -depth / 2 - 0.05),
      new THREE.Vector3(0, 0, -depth / 2 - 0.05 + ONE_FOOT),
    ];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
    });
    const line = new THREE.Line(lineGeom, lineMat);
    rulerGroup.add(line);

    // Label
    const label = createFootLabel();
    label.position.set(0.02, 0.02, -depth / 2 - 0.05 + ONE_FOOT / 2);
    rulerGroup.add(label);

    // Position ruler on floor, along right edge
    rulerGroup.position.set(width / 2 + 0.08, floorY, 0);
    group.add(rulerGroup);
  }
}

/**
 * Add front edge highlight to indicate box orientation
 * This helps users understand which way the box is facing
 */
function addFrontEdgeHighlight(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  // Create a brighter line along the front bottom edge
  const frontEdgePoints = [
    new THREE.Vector3(-width / 2, -height / 2, depth / 2),
    new THREE.Vector3(width / 2, -height / 2, depth / 2),
  ];
  const frontEdgeGeom = new THREE.BufferGeometry().setFromPoints(frontEdgePoints);
  const frontEdgeMat = new THREE.LineBasicMaterial({
    color: 0x00ff88, // Bright green to stand out
    transparent: true,
    opacity: 0.8,
  });
  const frontEdge = new THREE.Line(frontEdgeGeom, frontEdgeMat);
  frontEdge.name = 'front-edge-highlight';
  group.add(frontEdge);

  // Add small arrow indicator pointing forward from front edge center
  const arrowSize = Math.min(width, depth) * 0.15;
  const arrowPoints = [
    new THREE.Vector3(0, -height / 2 + 0.002, depth / 2),
    new THREE.Vector3(0, -height / 2 + 0.002, depth / 2 + arrowSize),
    // Arrow head left
    new THREE.Vector3(0, -height / 2 + 0.002, depth / 2 + arrowSize),
    new THREE.Vector3(-arrowSize * 0.4, -height / 2 + 0.002, depth / 2 + arrowSize * 0.6),
    // Arrow head right
    new THREE.Vector3(0, -height / 2 + 0.002, depth / 2 + arrowSize),
    new THREE.Vector3(arrowSize * 0.4, -height / 2 + 0.002, depth / 2 + arrowSize * 0.6),
  ];
  const arrowGeom = new THREE.BufferGeometry().setFromPoints(arrowPoints);
  const arrowMat = new THREE.LineBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.5,
  });
  const arrow = new THREE.LineSegments(arrowGeom, arrowMat);
  arrow.name = 'front-arrow';
  group.add(arrow);
}

/**
 * Add rotation arc indicator on the floor - DISABLED
 * The top corner rotation handles already show rotation capability
 */
function addRotationArc(
  _group: THREE.Group,
  _width: number,
  _height: number,
  _depth: number,
  _rotation_deg: number
): void {
  // Intentionally empty - rotation is indicated by top corner handles only
}

/**
 * Add visible handles based on control mode
 * - Move mode: shows 4-way arrows at bottom corners
 * - Rotate mode: shows rotation arcs at top corners
 * - Resize mode: shows edge arrows and top face arrow
 */
function addInteractionHandles(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  hitScaleFactor: number = 1.0,
  controlMode: ControlMode = 'resize'
): void {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  // Invisible material for hit regions
  const hitMaterial = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide,
  });

  // Reusable arrow helper for mode-specific visual cues
  const createArrow = (
    name: string,
    userData: object,
    direction: THREE.Vector3,
    position: THREE.Vector3,
    color: number,
    opacity: number,
    hitSize: number = 0.1 * hitScaleFactor
  ) => {
    const arrowGroup = new THREE.Group();
    arrowGroup.name = name;
    arrowGroup.userData = userData;

    const arrowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
    });

    const headLength = 0.045;
    const headRadius = 0.018;
    const stemLength = 0.055;
    const stemRadius = 0.005;

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(headRadius, headLength, 8),
      arrowMaterial.clone()
    );
    cone.userData = { baseColor: color, baseOpacity: opacity };
    cone.position.set(0, stemLength / 2 + headLength / 2, 0);
    arrowGroup.add(cone);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(stemRadius, stemRadius, stemLength, 8),
      arrowMaterial.clone()
    );
    stem.userData = { baseColor: color, baseOpacity: opacity };
    arrowGroup.add(stem);

    const unitDirection = direction.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    arrowGroup.quaternion.setFromUnitVectors(up, unitDirection);

    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(hitSize, hitSize, hitSize),
      hitMaterial.clone()
    );
    arrowGroup.add(hitBox);

    arrowGroup.position.copy(position);
    return arrowGroup;
  };

  const arrowOffset = 0.05; // Distance from box face

  // RESIZE MODE: Distinct colored arrows per face
  if (controlMode === 'resize') {
    group.add(createArrow(
      'handle-edge-front',
      { handleType: 'edge', edge: 'front', axis: 'depth', direction: 1 },
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, hd + arrowOffset),
      0xef4444,
      0.75
    ));

    group.add(createArrow(
      'handle-edge-back',
      { handleType: 'edge', edge: 'back', axis: 'depth', direction: -1 },
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, -hd - arrowOffset),
      0xf97316,
      0.75
    ));

    group.add(createArrow(
      'handle-edge-left',
      { handleType: 'edge', edge: 'left', axis: 'width', direction: -1 },
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(-hw - arrowOffset, 0, 0),
      0x2563eb,
      0.75
    ));

    group.add(createArrow(
      'handle-edge-right',
      { handleType: 'edge', edge: 'right', axis: 'width', direction: 1 },
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(hw + arrowOffset, 0, 0),
      0x22d3ee,
      0.75
    ));

    group.add(createArrow(
      'handle-top-face',
      { handleType: 'topFace' },
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, hh + 0.05, 0),
      0xa855f7,
      0.75,
      0.12 * hitScaleFactor
    ));
  } // End resize mode

  // Bottom face hit region - controls position (move box)
  // Use a thicker box at floor level
  const bottomFaceGeom = new THREE.BoxGeometry(width * 0.4, 0.05, depth * 0.4);
  const bottomFace = new THREE.Mesh(bottomFaceGeom, hitMaterial.clone());
  bottomFace.position.set(0, -hh + 0.025, 0);
  bottomFace.userData = { handleType: 'bottomFace' };
  bottomFace.name = 'handle-bottom-face';
  group.add(bottomFace);

  // ROTATE MODE: Circular arrow around the box
  if (controlMode === 'rotate') {
    const rotationHandleMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });

    const rotationGroup = new THREE.Group();
    rotationGroup.name = 'handle-corner-top-ring';
    rotationGroup.userData = { handleType: 'cornerTop', cornerIndex: 0 };
    rotationGroup.position.set(0, 0, 0);

    const ringRadius = Math.max(hw, hd) + 0.1;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius, 0.007, 12, 96),
      rotationHandleMat.clone()
    );
    ring.rotation.x = Math.PI / 2;
    ring.userData = { baseColor: 0xa855f7, baseOpacity: 0.8 };
    rotationGroup.add(ring);

    const arrowAngles = [Math.PI / 4, (5 * Math.PI) / 4];
    for (const angle of arrowAngles) {
      const arrowHead = new THREE.Mesh(
        new THREE.ConeGeometry(0.022, 0.045, 10),
        rotationHandleMat.clone()
      );
      const tangent = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)).normalize();
      arrowHead.position.set(
        Math.cos(angle) * ringRadius,
        0,
        Math.sin(angle) * ringRadius
      );
      arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      arrowHead.userData = { baseColor: 0xa855f7, baseOpacity: 0.8 };
      rotationGroup.add(arrowHead);
    }

    const hitRing = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius, 0.05 * hitScaleFactor, 8, 24),
      hitMaterial.clone()
    );
    hitRing.rotation.x = Math.PI / 2;
    rotationGroup.add(hitRing);

    group.add(rotationGroup);
  } // End rotate mode

  // MOVE MODE: Prominent outward arrows around box footprint
  if (controlMode === 'move') {
    const moveGroup = new THREE.Group();
    moveGroup.name = 'handle-corner-bottom-cluster';
    moveGroup.userData = { handleType: 'cornerBottom', cornerIndex: 0 };
    moveGroup.position.set(0, -hh + 0.06, 0);

    const ringRadius = Math.max(hw, hd) + 0.12;
    const arrowCount = 8;
    for (let i = 0; i < arrowCount; i++) {
      const angle = (i / arrowCount) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();

      const arrow = createArrow(
        `handle-corner-bottom-${i}`,
        { handleType: 'cornerBottom', cornerIndex: (i % 4) as 0 | 1 | 2 | 3 },
        radial,
        new THREE.Vector3(
          Math.cos(angle) * ringRadius,
          0,
          Math.sin(angle) * ringRadius
        ),
        0x22d3ee,
        0.85,
        0.09 * hitScaleFactor
      );
      moveGroup.add(arrow);
    }
    group.add(moveGroup);
  } // End move mode
}

/**
 * Add textured logo to the front face of the box
 * Logo is scaled down with whitespace around it, only on the front face
 */
function addTexturedSideFaces(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  if (!logoTexture) return; // Texture not loaded yet

  // Create textured material for the logo
  const texturedMaterial = new THREE.MeshBasicMaterial({
    map: logoTexture,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const hd = depth / 2;

  // Logo size - scaled to be visible but with whitespace around it
  // Use 60% of the smaller dimension for better visibility
  const logoScale = 0.6;
  const logoWidth = Math.min(width, height) * logoScale;
  const logoHeight = logoWidth * 0.4; // Approximate aspect ratio of the Keep logo

  // Front face only (facing +Z) - logo centered
  const frontGeom = new THREE.PlaneGeometry(logoWidth, logoHeight);
  const frontFace = new THREE.Mesh(frontGeom, texturedMaterial);
  frontFace.position.set(0, 0, hd + 0.002); // Slightly offset to prevent z-fighting
  frontFace.name = 'textured-face-front';
  group.add(frontFace);
}

/**
 * Add a rotation guide circle that appears during corner rotation
 * This is added separately and can be shown/hidden
 */
export function addRotationGuide(
  scene: THREE.Scene,
  centerX: number,
  floorY: number,
  centerZ: number,
  radius: number
): THREE.Line {
  // Create circle geometry
  const segments = 64;
  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        centerX + Math.cos(angle) * radius,
        floorY + 0.002,
        centerZ + Math.sin(angle) * radius
      )
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xc084fc,
    transparent: true,
    opacity: 0.3,
  });

  const circle = new THREE.Line(geometry, material);
  circle.name = 'rotation-guide';
  scene.add(circle);

  return circle;
}

/**
 * Remove the rotation guide from the scene
 */
export function removeRotationGuide(scene: THREE.Scene): void {
  const guide = scene.getObjectByName('rotation-guide');
  if (guide) {
    scene.remove(guide);
    if (guide instanceof THREE.Line) {
      guide.geometry.dispose();
      (guide.material as THREE.Material).dispose();
    }
  }
}

/**
 * Create a bounding box with explicit dimensions at a given center position.
 * @param centerX - World X coordinate of box center
 * @param centerY - World Y coordinate of box center (middle height)
 * @param centerZ - World Z coordinate of box center
 * @param width - Box width (local X dimension)
 * @param height - Box height (local Y dimension)
 * @param depth - Box depth (local Z dimension)
 * @param rotation_deg - Rotation around Y axis in degrees
 */
function createBoxAtCenter(
  centerX: number,
  centerY: number,
  centerZ: number,
  width: number,
  height: number,
  depth: number,
  rotation_deg: number,
  hitScaleFactor: number = 1.0,
  controlMode: ControlMode = 'resize'
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bounding-box';

  // Create regular box geometry with straight edges
  const geometry = new THREE.BoxGeometry(width, height, depth);

  // Translucent fill - white with low opacity
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Colored edges - cyan for horizontal (W/D), purple for vertical (H)
  addColoredEdges(group, width, height, depth);

  // Add textured side faces with logo
  addTexturedSideFaces(group, width, height, depth);

  // Add contact shadow (floor footprint)
  addContactShadow(group, width, height, depth);

  // Add floor edge glow
  addFloorEdgeGlow(group, width, height, depth);

  // Add scale reference (1-foot ruler ticks)
  addScaleReference(group, width, height, depth);

  // Add front edge highlight for orientation
  addFrontEdgeHighlight(group, width, height, depth);

  // Add rotation arc indicator (shows rotation angle on floor)
  addRotationArc(group, width, height, depth, rotation_deg);

  // Add dimension labels
  addDimensionLabels(group, width, height, depth);

  // Add interaction handles for direct manipulation (only in resize mode)
  addInteractionHandles(group, width, height, depth, hitScaleFactor, controlMode);

  // Position the group at the center
  group.position.set(centerX, centerY, centerZ);

  // Apply rotation around Y axis
  group.rotation.y = (rotation_deg * Math.PI) / 180;

  return group;
}

/**
 * Create or update a bounding box from two floor points and a height value.
 * The box is positioned between the two floor points and extends upward.
 * @param rotation_deg - Optional rotation in degrees (applied around Y axis)
 */
export function createFloorBoundingBox(
  floorPoint1: MeasurementPoint,
  floorPoint2: MeasurementPoint,
  height: number,
  rotation_deg: number = 0,
  hitScaleFactor: number = 1.0,
  controlMode: ControlMode = 'resize'
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bounding-box';

  const p1 = floorPoint1.position;
  const p2 = floorPoint2.position;

  // Calculate dimensions (absolute values for size)
  const width = Math.abs(p2.x - p1.x);
  const depth = Math.abs(p2.z - p1.z);

  // Calculate center position (midpoint of floor diagonal, raised by half height)
  const centerX = (p1.x + p2.x) / 2;
  const centerY = Math.min(p1.y, p2.y) + height / 2;
  const centerZ = (p1.z + p2.z) / 2;

  // Create regular box geometry with straight edges
  const geometry = new THREE.BoxGeometry(width, height, depth);

  // Translucent fill - white with low opacity
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Colored edges - cyan for horizontal (W/D), purple for vertical (H)
  addColoredEdges(group, width, height, depth);

  // Add textured side faces with logo
  addTexturedSideFaces(group, width, height, depth);

  // Add contact shadow (floor footprint)
  addContactShadow(group, width, height, depth);

  // Add floor edge glow
  addFloorEdgeGlow(group, width, height, depth);

  // Add scale reference (1-foot ruler ticks)
  addScaleReference(group, width, height, depth);

  // Add front edge highlight for orientation
  addFrontEdgeHighlight(group, width, height, depth);

  // Add rotation arc indicator (shows rotation angle on floor)
  addRotationArc(group, width, height, depth, rotation_deg);

  // Add dimension labels
  addDimensionLabels(group, width, height, depth);

  // Add interaction handles for direct manipulation (only in resize mode)
  addInteractionHandles(group, width, height, depth, hitScaleFactor, controlMode);

  // Position the group at the center
  group.position.set(centerX, centerY, centerZ);

  // Apply rotation around Y axis (yaw)
  // Convert degrees to radians
  group.rotation.y = (rotation_deg * Math.PI) / 180;

  return group;
}

/**
 * Update or create the bounding box in the scene
 * @param overrideWidth - Optional override for width (used in LLM mode when user adjusts sliders)
 * @param overrideDepth - Optional override for depth (used in LLM mode when user adjusts sliders)
 * @param rotation_deg - Optional rotation in degrees (default 0)
 * @param hitScaleFactor - Scale factor for hitbox sizes (larger screens need larger hitboxes)
 * @param controlMode - Current control mode for handle visibility
 */
export function updateBoundingBox(
  scene: THREE.Scene,
  floorPoint1: MeasurementPoint | null,
  floorPoint2: MeasurementPoint | null,
  height: number,
  overrideWidth?: number,
  overrideDepth?: number,
  rotation_deg: number = 0,
  hitScaleFactor: number = 1.0,
  controlMode: ControlMode = 'resize'
): void {
  // Remove existing bounding box
  const existing = scene.getObjectByName('bounding-box');
  if (existing) {
    scene.remove(existing);
    existing.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      // Dispose Line2 objects (thick lines)
      if (child instanceof Line2) {
        child.geometry.dispose();
        (child.material as LineMaterial).dispose();
      }
      // Dispose sprite textures and materials
      if (child instanceof THREE.Sprite) {
        if (child.material.map) {
          child.material.map.dispose();
        }
        child.material.dispose();
      }
    });
  }

  // Only show box when we have both floor points
  if (!floorPoint1 || !floorPoint2) {
    return;
  }

  // Ensure minimum dimensions for visibility
  const minDim = 0.02; // 2cm minimum
  const p1 = floorPoint1.position;
  const p2 = floorPoint2.position;

  // When we have explicit width/depth overrides, use the new createBoxAtCenter function
  // This properly handles rotation by using explicit dimensions instead of calculating from points
  if (overrideWidth !== undefined && overrideDepth !== undefined) {
    const actualWidth = Math.max(overrideWidth, minDim);
    const actualDepth = Math.max(overrideDepth, minDim);
    const actualHeight = Math.max(height, minDim);

    // Calculate center of current box
    const centerX = (p1.x + p2.x) / 2;
    const centerY = Math.min(p1.y, p2.y) + actualHeight / 2;
    const centerZ = (p1.z + p2.z) / 2;

    const box = createBoxAtCenter(
      centerX,
      centerY,
      centerZ,
      actualWidth,
      actualHeight,
      actualDepth,
      rotation_deg,
      hitScaleFactor,
      controlMode
    );
    scene.add(box);
    return;
  }

  // Manual drag mode - preserve actual drag direction
  const deltaX = p2.x - p1.x;
  const deltaZ = p2.z - p1.z;
  const actualWidth = Math.max(Math.abs(deltaX), minDim);
  const actualDepth = Math.max(Math.abs(deltaZ), minDim);
  const actualHeight = Math.max(height, minDim);

  // Preserve the sign/direction of the drag
  const adjustedP1: MeasurementPoint = {
    ...floorPoint1,
    position: p1.clone(),
  };
  const adjustedP2: MeasurementPoint = {
    ...floorPoint2,
    position: new THREE.Vector3(
      p1.x + (Math.sign(deltaX) * actualWidth),
      p2.y,
      p1.z + (Math.sign(deltaZ) * actualDepth)
    ),
  };

  const box = createFloorBoundingBox(adjustedP1, adjustedP2, actualHeight, rotation_deg, hitScaleFactor, controlMode);
  scene.add(box);
}

/**
 * Dispose of the bounding box
 */
export function disposeBoundingBox(scene: THREE.Scene): void {
  const existing = scene.getObjectByName('bounding-box');
  if (existing) {
    scene.remove(existing);
    existing.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      // Dispose Line2 objects (thick lines)
      if (child instanceof Line2) {
        child.geometry.dispose();
        (child.material as LineMaterial).dispose();
      }
      // Dispose sprite textures and materials
      if (child instanceof THREE.Sprite) {
        if (child.material.map) {
          child.material.map.dispose();
        }
        child.material.dispose();
      }
    });
  }
}

/**
 * Highlight tutorial handles with a pulsing glow effect
 * @param scene - The Three.js scene
 * @param handleType - 'move' (lower corners), 'rotate' (upper corners), 'resize' (edge arrows), or null to clear
 */
export function setTutorialHighlight(
  scene: THREE.Scene,
  handleType: 'move' | 'rotate' | 'resize' | null
): void {
  const boundingBox = scene.getObjectByName('bounding-box');
  if (!boundingBox) return;

  // Highlight color
  const glowColor = 0xffd700; // Gold/yellow for tutorial highlight

  boundingBox.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
      const userData = child.parent?.userData;
      if (!userData?.handleType) return;

      // Skip invisible hit boxes
      if (!child.material.visible) return;

      const isMove = userData.handleType === 'cornerBottom';
      const isRotate = userData.handleType === 'cornerTop';
      const isResize = userData.handleType === 'edge' || userData.handleType === 'topFace';

      // Determine if this handle should be highlighted
      const shouldHighlight =
        (handleType === 'move' && isMove) ||
        (handleType === 'rotate' && isRotate) ||
        (handleType === 'resize' && isResize);

      if (shouldHighlight) {
        // Set glow color and increase opacity
        child.material.color.setHex(glowColor);
        child.material.opacity = 0.9;
      } else {
        const baseColor = typeof child.userData.baseColor === 'number'
          ? child.userData.baseColor
          : (isRotate ? 0xa855f7 : 0x22d3ee);
        const baseOpacity = typeof child.userData.baseOpacity === 'number'
          ? child.userData.baseOpacity
          : (isResize ? 0.75 : 0.85);
        child.material.color.setHex(baseColor);
        child.material.opacity = baseOpacity;
      }
    }
  });
}
