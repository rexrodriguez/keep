import * as THREE from 'three';

export interface DepthBoxResult {
  success: boolean;
  width_m: number;
  depth_m: number;
  height_m: number;
  center: THREE.Vector3;
  pointCount: number;
}

/** Generic depth reader — works for both CPU and GPU-adapted depth info */
export interface DepthReader {
  readonly width: number;
  readonly height: number;
  getDepthInMeters(x: number, y: number): number;
}

const MIN_DIMENSION_M = 0.05;
const MAX_DIMENSION_M = 5.0;
const MIN_VALID_DEPTH_M = 0.1;
const MAX_VALID_DEPTH_M = 10.0;
const MIN_POINT_COUNT = 10;
const FLOOR_TOLERANCE_M = 0.03;
// Sparse sampling: ~16×16 = 256 samples (was 40×40 = 1600)
const SAMPLE_RADIUS_PX = 45;
const SAMPLE_STEP_PX = 6;

/**
 * Compute a bounding box from depth data around a tap point.
 *
 * Projects the tap position into the depth buffer, samples a sparse
 * neighborhood of pixels, unprojects them to 3D in local-floor space,
 * filters out floor points, and returns the AABB of the remaining points.
 */
export function computeDepthBoundingBox(
  depthInfo: DepthReader,
  view: XRView,
  viewerPose: XRViewerPose,
  tapFloorPosition: THREE.Vector3,
  floorY: number,
): DepthBoxResult {
  const fail: DepthBoxResult = {
    success: false,
    width_m: 0,
    depth_m: 0,
    height_m: 0,
    center: tapFloorPosition.clone(),
    pointCount: 0,
  };

  // Build matrices for coordinate transforms
  const projMatrix = new THREE.Matrix4().fromArray(view.projectionMatrix);
  const invProjMatrix = projMatrix.clone().invert();
  const viewMatrix = new THREE.Matrix4().fromArray(view.transform.matrix);

  // Project tap position (world space) into normalized view coordinates
  const invViewMatrix = viewMatrix.clone().invert();
  const tapViewSpace = tapFloorPosition.clone().applyMatrix4(invViewMatrix);
  const tapClip = tapViewSpace.clone().applyMatrix4(projMatrix);
  // Clip to normalized view: x = (clipX + 1) / 2, y = (1 - clipY) / 2
  const tapNormViewX = (tapClip.x + 1) / 2;
  const tapNormViewY = (1 - tapClip.y) / 2;

  // Convert to depth buffer pixel coordinates
  const tapPixelX = Math.round(tapNormViewX * depthInfo.width);
  const tapPixelY = Math.round(tapNormViewY * depthInfo.height);

  // Sample sparse grid of depth values around the tap point
  const worldPoints: THREE.Vector3[] = [];

  for (let dy = -SAMPLE_RADIUS_PX; dy <= SAMPLE_RADIUS_PX; dy += SAMPLE_STEP_PX) {
    for (let dx = -SAMPLE_RADIUS_PX; dx <= SAMPLE_RADIUS_PX; dx += SAMPLE_STEP_PX) {
      const px = tapPixelX + dx;
      const py = tapPixelY + dy;

      // Skip out-of-bounds pixels
      if (px < 0 || px >= depthInfo.width || py < 0 || py >= depthInfo.height) {
        continue;
      }

      // getDepthInMeters takes normalized view coordinates (0-1)
      const normX = px / depthInfo.width;
      const normY = py / depthInfo.height;

      let depthM: number;
      try {
        depthM = depthInfo.getDepthInMeters(normX, normY);
      } catch {
        continue;
      }

      // Filter invalid depth values
      if (depthM <= MIN_VALID_DEPTH_M || depthM >= MAX_VALID_DEPTH_M || !isFinite(depthM)) {
        continue;
      }

      // Unproject: pixel → normalized view → clip → view space → world space
      const clipX = normX * 2 - 1;
      const clipY = 1 - normY * 2;

      // Unproject clip coords to view-space ray direction
      const ndcPoint = new THREE.Vector4(clipX, clipY, -1, 1);
      ndcPoint.applyMatrix4(invProjMatrix);
      const rayDir = new THREE.Vector3(
        ndcPoint.x / ndcPoint.w,
        ndcPoint.y / ndcPoint.w,
        ndcPoint.z / ndcPoint.w,
      ).normalize();

      // Scale ray by depth to get view-space point
      const viewSpacePoint = rayDir.multiplyScalar(depthM);

      // Transform to local-floor (world) space
      const worldPoint = viewSpacePoint.applyMatrix4(viewMatrix);

      worldPoints.push(worldPoint);
    }
  }

  // Separate above-floor points from floor points
  const aboveFloorPoints = worldPoints.filter(
    p => p.y > floorY + FLOOR_TOLERANCE_M
  );

  if (aboveFloorPoints.length < MIN_POINT_COUNT) {
    return fail;
  }

  // IQR-based outlier rejection on each axis
  const filtered = rejectOutliers(aboveFloorPoints);

  if (filtered.length < MIN_POINT_COUNT) {
    return fail;
  }

  // Compute AABB from filtered above-floor points
  let minX = Infinity, maxX = -Infinity;
  let maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of filtered) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  let width = maxX - minX;
  let depth = maxZ - minZ;
  let height = maxY - floorY;

  // Clamp to sane ranges
  width = clamp(width, MIN_DIMENSION_M, MAX_DIMENSION_M);
  depth = clamp(depth, MIN_DIMENSION_M, MAX_DIMENSION_M);
  height = clamp(height, MIN_DIMENSION_M, MAX_DIMENSION_M);

  const center = new THREE.Vector3(
    (minX + maxX) / 2,
    floorY,
    (minZ + maxZ) / 2,
  );

  return {
    success: true,
    width_m: width,
    depth_m: depth,
    height_m: height,
    center,
    pointCount: filtered.length,
  };
}

// ─── GPU Depth Reader ────────────────────────────────────────────────────────
// Reads XRWebGLDepthInformation (gpu-optimized) into a CPU-accessible format
// using a shader pass. Only one readback per tap — no per-frame overhead.

const DEPTH_VS = `#version 300 es
void main() {
  // Fullscreen triangle from vertex ID (no vertex buffer needed)
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision highp float;
uniform sampler2D uDepth;
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uDepth, 0);
  vec2 uv = gl_FragCoord.xy / vec2(size);
  vec4 d = texture(uDepth, uv);
  // luminance-alpha: sampled as (L, L, L, A)
  // Store L in R channel, A in G channel for CPU-side 16-bit reconstruction
  outColor = vec4(d.r, d.a, 0.0, 1.0);
}`;

export interface GPUDepthReaderHandle {
  /** Read GPU depth texture into a CPU-accessible DepthReader */
  read(gpuDepthInfo: XRWebGLDepthInformation): DepthReader | null;
  dispose(): void;
}

export function createGPUDepthReader(gl: WebGL2RenderingContext): GPUDepthReaderHandle | null {
  // Compile vertex shader
  const vs = gl.createShader(gl.VERTEX_SHADER);
  if (!vs) return null;
  gl.shaderSource(vs, DEPTH_VS);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    console.warn('Depth VS compile error:', gl.getShaderInfoLog(vs));
    gl.deleteShader(vs);
    return null;
  }

  // Compile fragment shader
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fs) { gl.deleteShader(vs); return null; }
  gl.shaderSource(fs, DEPTH_FS);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.warn('Depth FS compile error:', gl.getShaderInfoLog(fs));
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  // Link program
  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vs); gl.deleteShader(fs); return null; }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Depth program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  const uDepthLoc = gl.getUniformLocation(program, 'uDepth');
  const vao = gl.createVertexArray();
  const fb = gl.createFramebuffer();

  // Render target texture (created/resized on demand)
  let renderTex: WebGLTexture | null = null;
  let rtWidth = 0;
  let rtHeight = 0;

  function ensureRenderTarget(w: number, h: number) {
    if (renderTex && rtWidth === w && rtHeight === h) return;
    if (renderTex) gl.deleteTexture(renderTex);
    renderTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, renderTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    rtWidth = w;
    rtHeight = h;
  }

  return {
    read(gpuDepthInfo: XRWebGLDepthInformation): DepthReader | null {
      const { texture, width, height, rawValueToMeters, normDepthBufferFromNormView } = gpuDepthInfo;
      if (!texture || width <= 0 || height <= 0) return null;

      // Save GL state that we'll modify
      const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
      const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

      try {
        // Setup render target (same size as depth buffer — typically small, ~160×120)
        ensureRenderTarget(width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTex, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          console.warn('Depth readback framebuffer incomplete');
          return null;
        }

        // Render depth texture through our shader to the RGBA8 target
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uDepthLoc, 0);
        gl.bindVertexArray(vao);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Read entire depth buffer to CPU (small — typically ~77KB for 160×120)
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // Build normDepthBufferFromNormView matrix for coordinate mapping
        const ndm = normDepthBufferFromNormView.matrix;

        return {
          width,
          height,
          getDepthInMeters(normViewX: number, normViewY: number): number {
            // Apply normDepthBufferFromNormView transform
            const dbX = ndm[0] * normViewX + ndm[4] * normViewY + ndm[12];
            const dbY = ndm[1] * normViewX + ndm[5] * normViewY + ndm[13];

            // Convert to pixel coordinates
            const px = Math.round(dbX * width);
            const py = Math.round(dbY * height);

            if (px < 0 || px >= width || py < 0 || py >= height) return 0;

            // readPixels uses bottom-left origin, same as GL
            const i = (py * width + px) * 4;
            // R = luminance (low byte), G = alpha (high byte)
            const lo = pixels[i];
            const hi = pixels[i + 1];
            const rawDepth = (hi << 8) | lo;

            return rawDepth * rawValueToMeters;
          },
        };
      } catch (e) {
        console.warn('GPU depth readback failed:', e);
        return null;
      } finally {
        // Restore GL state so Three.js can render normally
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
        gl.useProgram(prevProgram);
        gl.bindVertexArray(prevVAO);
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
        gl.activeTexture(prevActiveTexture);
      }
    },

    dispose() {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteFramebuffer(fb);
      gl.deleteVertexArray(vao);
      if (renderTex) gl.deleteTexture(renderTex);
    },
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * IQR-based outlier rejection: for each axis, discard points beyond
 * 1.5 * IQR from Q1/Q3. Returns the intersection of inliers across all axes.
 */
function rejectOutliers(points: THREE.Vector3[]): THREE.Vector3[] {
  const xs = points.map(p => p.x).sort((a, b) => a - b);
  const ys = points.map(p => p.y).sort((a, b) => a - b);
  const zs = points.map(p => p.z).sort((a, b) => a - b);

  const xRange = iqrRange(xs);
  const yRange = iqrRange(ys);
  const zRange = iqrRange(zs);

  return points.filter(p =>
    p.x >= xRange[0] && p.x <= xRange[1] &&
    p.y >= yRange[0] && p.y <= yRange[1] &&
    p.z >= zRange[0] && p.z <= zRange[1]
  );
}

function iqrRange(sorted: number[]): [number, number] {
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  return [q1 - 1.5 * iqr, q3 + 1.5 * iqr];
}
