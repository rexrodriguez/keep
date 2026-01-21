import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { MeasurementPoint } from '@/lib/types';

// Preload the logo texture once
const textureLoader = new THREE.TextureLoader();
let logoTexture: THREE.Texture | null = null;

// Load texture asynchronously
textureLoader.load('/Extra_Space_Storage_Logo.png', (texture) => {
  logoTexture = texture;
  logoTexture.colorSpace = THREE.SRGBColorSpace;
});

// Re-export handle types for external use
export type { HandleType, EdgeType, AxisType } from './handle-raycasting';

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

  // Black line material with increased width
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
 * Add rotation arc indicator on the floor
 * Shows the current rotation angle visually
 */
function addRotationArc(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  rotation_deg: number
): void {
  // Only show arc if there's meaningful rotation
  if (Math.abs(rotation_deg) < 5) return;

  const floorY = -height / 2 + 0.003;
  const arcRadius = Math.max(width, depth) * 0.6;

  // Create arc from 0 to current rotation
  const startAngle = -Math.PI / 2; // Points forward (negative Z in local, but we're showing from front)
  const endAngle = startAngle + (rotation_deg * Math.PI) / 180;

  const arcPoints: THREE.Vector3[] = [];
  const segments = Math.max(8, Math.abs(Math.round(rotation_deg / 5)));
  const angleStep = (endAngle - startAngle) / segments;

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + i * angleStep;
    arcPoints.push(
      new THREE.Vector3(
        Math.cos(angle) * arcRadius,
        floorY,
        Math.sin(angle) * arcRadius
      )
    );
  }

  const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const arcMat = new THREE.LineBasicMaterial({
    color: 0xa855f7, // Purple to match rotation control
    transparent: true,
    opacity: 0.4,
  });
  const arc = new THREE.Line(arcGeom, arcMat);
  arc.name = 'rotation-arc';

  // Add to group BEFORE rotation is applied (so arc shows in world space)
  // We need a separate group that doesn't rotate
  const arcGroup = new THREE.Group();
  arcGroup.name = 'rotation-arc-group';
  arcGroup.add(arc);

  // Add tick marks at 0° and current angle
  const tickLength = 0.03;

  // Start tick (0°)
  const startTickPoints = [
    new THREE.Vector3(
      Math.cos(startAngle) * (arcRadius - tickLength),
      floorY,
      Math.sin(startAngle) * (arcRadius - tickLength)
    ),
    new THREE.Vector3(
      Math.cos(startAngle) * (arcRadius + tickLength),
      floorY,
      Math.sin(startAngle) * (arcRadius + tickLength)
    ),
  ];
  const startTickGeom = new THREE.BufferGeometry().setFromPoints(startTickPoints);
  const startTick = new THREE.Line(startTickGeom, arcMat.clone());
  arcGroup.add(startTick);

  // End tick (current rotation)
  const endTickPoints = [
    new THREE.Vector3(
      Math.cos(endAngle) * (arcRadius - tickLength),
      floorY,
      Math.sin(endAngle) * (arcRadius - tickLength)
    ),
    new THREE.Vector3(
      Math.cos(endAngle) * (arcRadius + tickLength),
      floorY,
      Math.sin(endAngle) * (arcRadius + tickLength)
    ),
  ];
  const endTickGeom = new THREE.BufferGeometry().setFromPoints(endTickPoints);
  const endTick = new THREE.Line(endTickGeom, arcMat.clone());
  arcGroup.add(endTick);

  group.add(arcGroup);
}

/**
 * Add invisible hit regions for direct manipulation of edges, faces, and corners
 * These are larger than visual elements for finger-friendly touch targets
 */
function addInteractionHandles(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number
): void {
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  // Invisible material for hit regions
  const hitMaterial = new THREE.MeshBasicMaterial({
    visible: false,
    side: THREE.DoubleSide,
  });

  // VISIBLE arrow handles for edges - clean arrows with stems
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0x22d3ee, // Cyan for width/depth
    transparent: true,
    opacity: 0.5, // Toned down
    depthTest: false,
  });

  const arrowHeadLength = 0.03; // 3cm arrow head
  const arrowHeadRadius = 0.015; // 1.5cm radius cone
  const stemLength = 0.04; // 4cm stem
  const stemRadius = 0.004; // 4mm stem

  // Helper to create arrow with stem
  const createEdgeArrow = (name: string, userData: object, rotation: THREE.Euler, position: THREE.Vector3) => {
    const arrowGroup = new THREE.Group();
    arrowGroup.name = name;
    arrowGroup.userData = userData;

    // Arrow head
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(arrowHeadRadius, arrowHeadLength, 6),
      arrowMaterial.clone()
    );
    cone.position.set(0, stemLength / 2 + arrowHeadLength / 2, 0);
    arrowGroup.add(cone);

    // Stem
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(stemRadius, stemRadius, stemLength, 6),
      arrowMaterial.clone()
    );
    arrowGroup.add(stem);

    // Apply rotation to whole group
    arrowGroup.rotation.copy(rotation);

    // Invisible hit box for easier touch
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      hitMaterial.clone()
    );
    arrowGroup.add(hitBox);

    arrowGroup.position.copy(position);
    return arrowGroup;
  };

  const arrowOffset = 0.05; // Distance from box face

  // Front arrow - controls depth
  group.add(createEdgeArrow(
    'handle-edge-front',
    { handleType: 'edge', edge: 'front', axis: 'depth', direction: 1 },
    new THREE.Euler(Math.PI / 2, 0, 0),
    new THREE.Vector3(0, 0, hd + arrowOffset)
  ));

  // Back arrow - controls depth
  group.add(createEdgeArrow(
    'handle-edge-back',
    { handleType: 'edge', edge: 'back', axis: 'depth', direction: -1 },
    new THREE.Euler(-Math.PI / 2, 0, 0),
    new THREE.Vector3(0, 0, -hd - arrowOffset)
  ));

  // Left arrow - controls width
  group.add(createEdgeArrow(
    'handle-edge-left',
    { handleType: 'edge', edge: 'left', axis: 'width', direction: -1 },
    new THREE.Euler(0, 0, Math.PI / 2),
    new THREE.Vector3(-hw - arrowOffset, 0, 0)
  ));

  // Right arrow - controls width
  group.add(createEdgeArrow(
    'handle-edge-right',
    { handleType: 'edge', edge: 'right', axis: 'width', direction: 1 },
    new THREE.Euler(0, 0, -Math.PI / 2),
    new THREE.Vector3(hw + arrowOffset, 0, 0)
  ));

  // Top face - VISIBLE upward arrow for height control (cleaner, smaller)
  const heightArrowMaterial = new THREE.MeshBasicMaterial({
    color: 0xc084fc, // Purple for height
    transparent: true,
    opacity: 0.5, // Toned down
    depthTest: false,
  });

  const topArrowGroup = new THREE.Group();
  topArrowGroup.name = 'handle-top-face';
  topArrowGroup.userData = { handleType: 'topFace' };

  // Upward pointing cone (smaller)
  const topCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.015, 0.03, 6),
    heightArrowMaterial.clone()
  );
  topCone.position.y = 0.035;
  topArrowGroup.add(topCone);

  // Stem below the cone
  const topStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.04, 6),
    heightArrowMaterial.clone()
  );
  topArrowGroup.add(topStem);

  // Invisible hit box for easier touch
  const topHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.15, 0.1),
    hitMaterial.clone()
  );
  topArrowGroup.add(topHitBox);

  topArrowGroup.position.set(0, hh + 0.04, 0);
  group.add(topArrowGroup);

  // Bottom face hit region - controls position (move box)
  // Use a thicker box at floor level
  const bottomFaceGeom = new THREE.BoxGeometry(width * 0.4, 0.05, depth * 0.4);
  const bottomFace = new THREE.Mesh(bottomFaceGeom, hitMaterial.clone());
  bottomFace.position.set(0, -hh + 0.025, 0);
  bottomFace.userData = { handleType: 'bottomFace' };
  bottomFace.name = 'handle-bottom-face';
  group.add(bottomFace);

  // UPPER corner handles for ROTATION (4 corners at top of box)
  // Clean curved arrows only - no spheres
  const rotationHandleMat = new THREE.MeshBasicMaterial({
    color: 0xc084fc, // Purple for rotation
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });

  const upperCornerPositions: [number, number, number, number][] = [
    [-hw, hh, hd, 0],   // top-front-left
    [hw, hh, hd, 1],    // top-front-right
    [hw, hh, -hd, 2],   // top-back-right
    [-hw, hh, -hd, 3],  // top-back-left
  ];

  for (const [x, y, z, index] of upperCornerPositions) {
    const cornerGroup = new THREE.Group();
    cornerGroup.name = `handle-corner-top-${index}`;
    cornerGroup.userData = { handleType: 'cornerTop', cornerIndex: index };

    // Curved arrow (arc with arrow head) - rotation indicator
    const arcRadius = 0.04;
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(arcRadius, 0.006, 8, 16, Math.PI * 0.75),
      rotationHandleMat.clone()
    );
    arc.rotation.x = -Math.PI / 2;
    // Orient arc to face outward from corner
    arc.rotation.z = (index * Math.PI) / 2 + Math.PI / 8;
    cornerGroup.add(arc);

    // Arrow head at end of arc
    const arrowHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.012, 0.025, 4),
      rotationHandleMat.clone()
    );
    const arcEndAngle = (index * Math.PI) / 2 + Math.PI / 8 + Math.PI * 0.75;
    arrowHead.position.set(
      Math.cos(arcEndAngle) * arcRadius,
      0,
      Math.sin(arcEndAngle) * arcRadius
    );
    arrowHead.rotation.y = -arcEndAngle + Math.PI / 2;
    cornerGroup.add(arrowHead);

    // Invisible hit box for easier touch
    const hitBox = new THREE.Mesh(
      new THREE.SphereGeometry(0.07),
      hitMaterial.clone()
    );
    cornerGroup.add(hitBox);

    cornerGroup.position.set(x, y + 0.01, z);
    group.add(cornerGroup);
  }

  // LOWER corner handles for MOVEMENT (4 corners at floor level)
  // Four-way arrows only - no spheres
  const moveHandleMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee, // Cyan for movement
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });

  const lowerCornerPositions: [number, number, number, number][] = [
    [-hw, -hh, hd, 0],   // bottom-front-left
    [hw, -hh, hd, 1],    // bottom-front-right
    [hw, -hh, -hd, 2],   // bottom-back-right
    [-hw, -hh, -hd, 3],  // bottom-back-left
  ];

  for (const [x, y, z, index] of lowerCornerPositions) {
    const cornerGroup = new THREE.Group();
    cornerGroup.name = `handle-corner-bottom-${index}`;
    cornerGroup.userData = { handleType: 'cornerBottom', cornerIndex: index };

    // Four arrows pointing outward (move icon) - no center sphere
    const miniArrowGeom = new THREE.ConeGeometry(0.01, 0.02, 4);
    const stemGeom = new THREE.CylinderGeometry(0.003, 0.003, 0.025, 4);
    const arrowDist = 0.035;
    const directions = [
      { angle: 0 },           // right (+X)
      { angle: Math.PI },     // left (-X)
      { angle: Math.PI / 2 }, // forward (+Z)
      { angle: -Math.PI / 2 }, // back (-Z)
    ];

    for (const dir of directions) {
      // Arrow head
      const arrow = new THREE.Mesh(miniArrowGeom, moveHandleMat.clone());
      arrow.position.set(
        Math.cos(dir.angle) * arrowDist,
        0,
        Math.sin(dir.angle) * arrowDist
      );
      arrow.rotation.z = -dir.angle - Math.PI / 2;
      arrow.rotation.order = 'YXZ';
      cornerGroup.add(arrow);

      // Stem
      const stem = new THREE.Mesh(stemGeom, moveHandleMat.clone());
      stem.position.set(
        Math.cos(dir.angle) * (arrowDist - 0.018),
        0,
        Math.sin(dir.angle) * (arrowDist - 0.018)
      );
      stem.rotation.z = Math.PI / 2;
      stem.rotation.y = dir.angle;
      stem.rotation.order = 'YXZ';
      cornerGroup.add(stem);
    }

    // Invisible hit box for easier touch
    const hitBox = new THREE.Mesh(
      new THREE.SphereGeometry(0.07),
      hitMaterial.clone()
    );
    cornerGroup.add(hitBox);

    cornerGroup.position.set(x, y + 0.025, z); // Raise slightly above floor
    group.add(cornerGroup);
  }
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

  // Logo size - smaller than the face with whitespace around it
  // Use 40% of the smaller dimension to ensure it fits with margin
  const logoScale = 0.4;
  const logoWidth = Math.min(width, height) * logoScale;
  const logoHeight = logoWidth * 0.5; // Approximate aspect ratio of the logo

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
  rotation_deg: number
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

  // Add interaction handles for direct manipulation (now visible)
  addInteractionHandles(group, width, height, depth);

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
  rotation_deg: number = 0
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

  // Add interaction handles for direct manipulation (now visible)
  addInteractionHandles(group, width, height, depth);

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
 */
export function updateBoundingBox(
  scene: THREE.Scene,
  floorPoint1: MeasurementPoint | null,
  floorPoint2: MeasurementPoint | null,
  height: number,
  overrideWidth?: number,
  overrideDepth?: number,
  rotation_deg: number = 0
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
      rotation_deg
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

  const box = createFloorBoundingBox(adjustedP1, adjustedP2, actualHeight, rotation_deg);
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
