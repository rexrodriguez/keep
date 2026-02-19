import * as THREE from 'three';
import { MeasurementPoint } from '@/lib/types';

/**
 * Create a point marker sphere
 */
export function createPointMarker(
  position: THREE.Vector3,
  index: number,
  isBase: boolean = true
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.02, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: isBase ? 0x4488ff : 0xff4488, // Blue for base, pink for height
    transparent: true,
    opacity: 0.9,
  });

  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(position);
  marker.name = `marker-${index}`;

  return marker;
}

/**
 * Create a line between two points
 */
export function createLineBetweenPoints(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: number = 0x4488ff
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({
    color,
    linewidth: 2,
  });

  return new THREE.Line(geometry, material);
}

/**
 * Create the base rectangle outline from 4 points
 */
export function createBaseOutline(points: THREE.Vector3[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'base-outline';

  if (points.length < 2) return group;

  const material = new THREE.LineBasicMaterial({
    color: 0x4488ff,
    linewidth: 2,
  });

  // Create lines connecting points in order
  for (let i = 0; i < points.length; i++) {
    const nextIndex = (i + 1) % points.length;
    if (nextIndex < points.length || points.length === 4) {
      // Only close the loop if we have all 4 points
      const actualNext = points.length === 4 ? nextIndex : Math.min(nextIndex, points.length - 1);
      if (i < actualNext || points.length === 4) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          points[i],
          points[actualNext],
        ]);
        const line = new THREE.Line(geometry, material);
        group.add(line);
      }
    }
  }

  return group;
}

/**
 * Create vertical guide line from base center to height
 */
export function createVerticalGuide(
  baseCenter: THREE.Vector3,
  maxHeight: number = 3
): THREE.Line {
  const topPoint = baseCenter.clone();
  topPoint.y += maxHeight;

  const geometry = new THREE.BufferGeometry().setFromPoints([baseCenter, topPoint]);
  const material = new THREE.LineDashedMaterial({
    color: 0xff4488,
    linewidth: 1,
    dashSize: 0.05,
    gapSize: 0.05,
  });

  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  line.name = 'vertical-guide';

  return line;
}

/**
 * Create measurement labels group
 */
export function createMeasurementLabels(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'measurement-labels';
  // Labels are rendered as DOM overlay, not 3D text
  return group;
}

/**
 * Update markers group with current points
 */
export function updateMarkersGroup(
  group: THREE.Group,
  basePoints: MeasurementPoint[],
  heightPoint: MeasurementPoint | null
): void {
  // Clear existing markers
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    } else if (child instanceof THREE.Line) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }

  // Add base point markers
  basePoints.forEach((point, index) => {
    const marker = createPointMarker(point.position, index, true);
    group.add(marker);
  });

  // Add base outline
  if (basePoints.length >= 2) {
    const positions = basePoints.map((p) => p.position);
    const outline = createBaseOutline(positions);
    group.add(outline);
  }

  // Add height point and vertical guide if we have base complete
  if (basePoints.length === 4) {
    // Calculate base center
    const center = new THREE.Vector3();
    basePoints.forEach((p) => center.add(p.position));
    center.divideScalar(4);

    // Add vertical guide
    const guide = createVerticalGuide(center);
    group.add(guide);

    // Add height marker if set
    if (heightPoint) {
      const heightMarker = createPointMarker(heightPoint.position, 4, false);
      group.add(heightMarker);

      // Add line from center to height point
      const heightLine = createLineBetweenPoints(center, heightPoint.position, 0xff4488);
      group.add(heightLine);
    }
  }
}
