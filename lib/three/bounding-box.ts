import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MeasurementPoint } from '@/lib/types';

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

  // Calculate corner radius - proportional to smallest dimension, max 2cm
  const minDim = Math.min(width, height, depth);
  const cornerRadius = Math.min(minDim * 0.08, 0.02);

  // Create rounded box geometry for softer, less CAD-like appearance
  const geometry = new RoundedBoxGeometry(width, height, depth, 4, cornerRadius);

  // Translucent fill - blue with low opacity
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Wireframe edges - brighter blue (use standard box for cleaner edges)
  const edgeBoxGeom = new THREE.BoxGeometry(width, height, depth);
  const edgesGeometry = new THREE.EdgesGeometry(edgeBoxGeom);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  group.add(edges);

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

  // Calculate corner radius - proportional to smallest dimension, max 2cm
  const minDim = Math.min(width, height, depth);
  const cornerRadius = Math.min(minDim * 0.08, 0.02);

  // Create rounded box geometry for softer, less CAD-like appearance
  const geometry = new RoundedBoxGeometry(width, height, depth, 4, cornerRadius);

  // Translucent fill - blue with low opacity
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const fillMesh = new THREE.Mesh(geometry, fillMaterial);
  group.add(fillMesh);

  // Wireframe edges - brighter blue (use standard box for cleaner edges)
  const edgeBoxGeom = new THREE.BoxGeometry(width, height, depth);
  const edgesGeometry = new THREE.EdgesGeometry(edgeBoxGeom);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    linewidth: 2,
  });
  const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  group.add(edges);

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
