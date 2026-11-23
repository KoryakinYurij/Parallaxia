import type {
  CameraMotionPreset,
  CameraRigState,
  DepthBrushTool,
  InpaintAlgorithm,
  InpaintResult,
  LdiSplitResult,
  SceneDepthBlueprint,
} from './types';

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes cinematographic 2.5D camera rig coordinates & FOV.
 * Supports true Dolly-Zoom (Vertigo effect) preserving frustum width at focal plane.
 */
export function computeCameraRig(params: {
  preset: CameraMotionPreset;
  timeSec: number;
  amplitude: number;
  pointerX: number;
  pointerY: number;
  exploded: boolean;
  baseFovDeg?: number;
  baseDistance?: number;
}): CameraRigState {
  const {
    preset,
    timeSec,
    amplitude,
    pointerX,
    pointerY,
    exploded,
    baseFovDeg = 38,
    baseDistance = 3.2,
  } = params;

  const amp = clamp(amplitude, 0, 1.5);
  const t = timeSec;

  if (exploded) {
    // 3D Inspection angle showing Z-separated LDI planes and inpainted background hole
    const sway = Math.sin(t * 0.55) * 0.14;
    return {
      offsetX: 0.42 + sway + pointerX * 0.25,
      offsetY: 0.14 + Math.cos(t * 0.4) * 0.05 + pointerY * 0.15,
      dollyZ: 0.55,
      fov: 42,
      yaw: 0.46 + sway * 0.55 + pointerX * 0.22,
      pitch: -0.09 + pointerY * 0.12,
      roll: 0,
    };
  }

  let offsetX = 0;
  let offsetY = 0;
  let dollyZ = 0;
  let fov = baseFovDeg;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;

  switch (preset) {
    case 'orbit': {
      offsetX = Math.sin(t * 0.75) * 0.28 * amp;
      offsetY = Math.cos(t * 0.75) * 0.15 * amp;
      dollyZ = Math.sin(t * 0.375) * 0.08 * amp;
      yaw = offsetX * 0.18;
      pitch = -offsetY * 0.14;
      break;
    }
    case 'dolly-zoom': {
      // Classic Vertigo / Hitchcock camera rig:
      // Move camera along Z while adjusting FOV so frustum height at focal distance stays constant:
      // tan(fov/2) * distance = constant
      const wave = Math.sin(t * 0.65);
      dollyZ = wave * 0.68 * amp;
      const currentDist = Math.max(1.2, baseDistance + dollyZ);
      const baseHalfHeight = Math.tan((baseFovDeg * Math.PI) / 360) * baseDistance;
      fov = (2 * Math.atan(baseHalfHeight / currentDist) * 180) / Math.PI;
      fov = clamp(fov, 18, 72);
      offsetX = Math.sin(t * 0.325) * 0.08 * amp;
      offsetY = Math.cos(t * 0.325) * 0.04 * amp;
      yaw = offsetX * 0.1;
      break;
    }
    case 'truck': {
      offsetX = Math.sin(t * 0.65) * 0.36 * amp;
      offsetY = Math.sin(t * 1.3) * 0.025 * amp;
      yaw = offsetX * 0.22;
      break;
    }
    case 'ken-burns': {
      // Smooth continuous documentary push-in & subtle lateral drift (looped with cosine easing)
      const cycle = 0.5 - 0.5 * Math.cos(t * 0.5);
      dollyZ = -cycle * 0.45 * amp;
      offsetX = (cycle - 0.5) * 0.24 * amp;
      offsetY = (cycle - 0.5) * 0.1 * amp;
      yaw = offsetX * 0.12;
      break;
    }
    case 'breathe': {
      offsetX = (Math.sin(t * 0.48) * 0.14 + Math.sin(t * 1.12) * 0.04) * amp;
      offsetY = (Math.cos(t * 0.62) * 0.11 + Math.sin(t * 0.93) * 0.03) * amp;
      dollyZ = Math.sin(t * 0.41) * 0.1 * amp;
      roll = Math.sin(t * 0.35) * 0.015 * amp;
      yaw = offsetX * 0.12;
      pitch = -offsetY * 0.1;
      break;
    }
    case 'pointer': {
      offsetX = clamp(pointerX, -1, 1) * 0.34 * amp;
      offsetY = clamp(pointerY, -1, 1) * 0.22 * amp;
      yaw = offsetX * 0.2;
      pitch = -offsetY * 0.16;
      break;
    }
  }

  return { offsetX, offsetY, dollyZ, fov, yaw, pitch, roll };
}

/**
 * Synthesizes a normalized [0..1] depth map (1 = near foreground, 0 = far background)
 * from an RGBA image buffer and optional semantic depth blueprint.
 * Uses color-aware silhouette matting inside semantic regions (separating subjects
 * from surrounding sky/mist borders) plus RGB-guided bilateral edge preservation.
 */
export function synthesizeDepthBuffer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  blueprint?: SceneDepthBlueprint | null,
): Float32Array {
  const total = width * height;
  const depth = new Float32Array(total);
  const luma = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    luma[i] = (0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]) / 255;
  }

  const horizonY = blueprint?.horizonY ?? 0.38;
  const groundSlope = blueprint?.groundSlope ?? 0.46;
  const edgeWeight = blueprint?.edgeWeight ?? 0.16;
  const regions = blueprint?.regions ?? [];

  // Pre-compute per-region center seed color and outer ring background color
  // so foreground regions snap tightly to real object silhouettes instead of bleeding into sky/mist
  const regionModels = regions.map((reg) => {
    const cxPx = clamp(Math.round(reg.cx * (width - 1)), 0, width - 1);
    const cyPx = clamp(Math.round(reg.cy * (height - 1)), 0, height - 1);
    let coreR = 0,
      coreG = 0,
      coreB = 0,
      coreL = 0,
      coreCnt = 0;

    const sampleRadX = Math.max(1, Math.round(reg.rx * width * 0.28));
    const sampleRadY = Math.max(1, Math.round(reg.ry * height * 0.28));
    for (let dy = -sampleRadY; dy <= sampleRadY; dy += Math.max(1, Math.floor(sampleRadY / 3))) {
      const sy = clamp(cyPx + dy, 0, height - 1);
      for (let dx = -sampleRadX; dx <= sampleRadX; dx += Math.max(1, Math.floor(sampleRadX / 3))) {
        const sx = clamp(cxPx + dx, 0, width - 1);
        const p = (sy * width + sx) * 4;
        coreR += rgba[p] / 255;
        coreG += rgba[p + 1] / 255;
        coreB += rgba[p + 2] / 255;
        coreL += luma[sy * width + sx];
        coreCnt++;
      }
    }
    if (coreCnt > 0) {
      coreR /= coreCnt;
      coreG /= coreCnt;
      coreB /= coreCnt;
      coreL /= coreCnt;
    }

    // Sample outer perimeter above/around region as local background reference
    let bgR = 0,
      bgG = 0,
      bgB = 0,
      bgL = 0,
      bgCnt = 0;
    const angles = 12;
    for (let a = 0; a < angles; a++) {
      const theta = (a / angles) * Math.PI * 2;
      // Favor upper half around object where sky/valley background lives
      const ox = Math.round((reg.cx + Math.cos(theta) * reg.rx * 1.25) * (width - 1));
      const oy = Math.round((reg.cy + Math.sin(theta) * reg.ry * 1.25) * (height - 1));
      if (ox < 0 || ox >= width || oy < 0 || oy >= height) continue;
      if (oy > cyPx + reg.ry * height * 0.5) continue;
      const p = (oy * width + ox) * 4;
      bgR += rgba[p] / 255;
      bgG += rgba[p + 1] / 255;
      bgB += rgba[p + 2] / 255;
      bgL += luma[oy * width + ox];
      bgCnt++;
    }
    if (bgCnt > 0) {
      bgR /= bgCnt;
      bgG /= bgCnt;
      bgB /= bgCnt;
      bgL /= bgCnt;
    }

    const contrastGap =
      bgCnt > 0
        ? Math.hypot(coreR - bgR, coreG - bgG, coreB - bgB)
        : 0;

    return {
      reg,
      coreR,
      coreG,
      coreB,
      coreL,
      bgR,
      bgG,
      bgB,
      bgL,
      hasBgRef: bgCnt >= 2 && contrastGap > 0.14,
    };
  });

  for (let y = 0; y < height; y++) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const nx = x / Math.max(1, width - 1);
      const p = y * width + x;

      // 1. Perspective baseline: above horizon is far sky/backdrop, below horizon approaches camera
      let d: number;
      if (ny < horizonY) {
        d = 0.06 + 0.14 * (ny / Math.max(0.01, horizonY));
      } else {
        const groundT = (ny - horizonY) / Math.max(0.01, 1 - horizonY);
        d = 0.2 + Math.pow(groundT, 1.15) * groundSlope;
      }

      // 2. Local image cues (edge sharpness & aerial perspective)
      const xm = x > 0 ? x - 1 : x;
      const xp = x < width - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y;
      const yp = y < height - 1 ? y + 1 : y;
      const gx = Math.abs(luma[y * width + xp] - luma[y * width + xm]);
      const gy = Math.abs(luma[yp * width + x] - luma[ym * width + x]);
      const edge = clamp((gx + gy) * 1.4, 0, 1);

      const idx = p * 4;
      const r = rgba[idx] / 255;
      const g = rgba[idx + 1] / 255;
      const b = rgba[idx + 2] / 255;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0.001 ? (maxC - minC) / maxC : 0;

      const hazePenalty = ny < horizonY + 0.15 ? luma[p] * (1 - sat * 0.5) * 0.12 : 0;
      const cueBoost = edge * edgeWeight + sat * 0.08 - hazePenalty;
      d = clamp(d + cueBoost, 0.02, 0.98);

      // 3. Semantic blueprint regions with color-similarity silhouette matting
      for (let rIdx = 0; rIdx < regionModels.length; rIdx++) {
        const model = regionModels[rIdx];
        const reg = model.reg;
        const rx = Math.max(0.01, reg.rx);
        const ry = Math.max(0.01, reg.ry);
        const soft = Math.max(0.015, reg.softness);

        let dist: number;
        if (reg.shape === 'rect') {
          const dx = Math.abs(nx - reg.cx) / rx;
          const dy = Math.abs(ny - reg.cy) / ry;
          dist = Math.max(dx, dy);
        } else {
          const dx = (nx - reg.cx) / rx;
          const dy = (ny - reg.cy) / ry;
          dist = Math.sqrt(dx * dx + dy * dy);
        }

        const spatialInfluence = 1 - smoothstep(1 - soft * 2.0, 1 + soft * 2.0, dist);
        if (spatialInfluence <= 0.001) continue;

        let matteWeight = spatialInfluence;

        if (reg.layer === 'foreground' && model.hasBgRef) {
          // Compare pixel color similarity to foreground seed vs surrounding sky/mist background
          const distToFg = Math.hypot(r - model.coreR, g - model.coreG, b - model.coreB);
          const distToBg = Math.hypot(r - model.bgR, g - model.bgG, b - model.bgB);
          // Foreground silhouettes in natural photography have distinct luminance/color vs bright hazy backdrop
          const fgAffinity = smoothstep(-0.08, 0.18, distToBg - distToFg * 0.78);
          // Core interior stays protected; outer silhouette boundary snaps strictly to color affinity
          const coreProtect = 1 - smoothstep(0.18, 0.52, dist);
          const silhouetteMask = Math.max(coreProtect * fgAffinity, fgAffinity);
          matteWeight = spatialInfluence * silhouetteMask;
        }

        if (matteWeight > 0.001) {
          d = d * (1 - matteWeight) + clamp(reg.depth, 0.02, 0.99) * matteWeight;
        }
      }

      depth[p] = clamp(d, 0, 1);
    }
  }

  return bilateralSmoothDepth(depth, rgba, width, height, 3, 0.11);
}

/**
 * Edge-preserving RGB-guided bilateral filter on the depth buffer.
 * Keeps depth transitions locked tightly to real object color boundaries.
 */
export function bilateralSmoothDepth(
  depth: Float32Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 3,
  colorSigma = 0.11,
): Float32Array {
  const out = new Float32Array(depth.length);
  const invTwoSigmaSq = 1 / (2 * colorSigma * colorSigma);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerIdx = y * width + x;
      const c4 = centerIdx * 4;
      const cr = rgba[c4] / 255;
      const cg = rgba[c4 + 1] / 255;
      const cb = rgba[c4 + 2] / 255;
      let sum = 0;
      let wSum = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          const n4 = nIdx * 4;
          const dr = rgba[n4] / 255 - cr;
          const dg = rgba[n4 + 1] / 255 - cg;
          const db = rgba[n4 + 2] / 255 - cb;
          const colorDistSq = dr * dr + dg * dg + db * db;
          const spatialW = 1 / (1 + (dx * dx + dy * dy) * 0.35);
          const rangeW = Math.exp(-colorDistSq * invTwoSigmaSq);
          const w = spatialW * rangeW;
          sum += depth[nIdx] * w;
          wSum += w;
        }
      }

      out[centerIdx] = wSum > 0 ? clamp(sum / wSum, 0, 1) : depth[centerIdx];
    }
  }

  return out;
}

/**
 * Interactive depth brush stroke (paint Near/White, Far/Black, or Smooth) directly on depth buffer.
 */
export function applyDepthBrushStroke(params: {
  depth: Float32Array;
  width: number;
  height: number;
  nx: number;
  ny: number;
  radiusNorm: number;
  strength: number;
  tool: DepthBrushTool;
}): boolean {
  const { depth, width, height, nx, ny, radiusNorm, strength, tool } = params;
  const cx = nx * (width - 1);
  const cy = ny * (height - 1);
  const radPx = Math.max(2, radiusNorm * Math.min(width, height));
  const radSq = radPx * radPx;

  const minX = Math.max(0, Math.floor(cx - radPx));
  const maxX = Math.min(width - 1, Math.ceil(cx + radPx));
  const minY = Math.max(0, Math.floor(cy - radPx));
  const maxY = Math.min(height - 1, Math.ceil(cy + radPx));

  if (minX > maxX || minY > maxY) return false;

  const alphaScale = clamp(strength, 0.05, 1) * 0.45;
  let snapshot: Float32Array | null = null;
  if (tool === 'smooth') {
    snapshot = new Float32Array(depth);
  }

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dSq = dx * dx + dy * dy;
      if (dSq > radSq) continue;

      const falloff = 1 - Math.sqrt(dSq) / radPx;
      const smoothFalloff = falloff * falloff * (3 - 2 * falloff);
      const w = smoothFalloff * alphaScale;
      const idx = y * width + x;

      if (tool === 'near') {
        depth[idx] = clamp(depth[idx] + (1 - depth[idx]) * w, 0, 1);
      } else if (tool === 'far') {
        depth[idx] = clamp(depth[idx] * (1 - w), 0, 1);
      } else if (tool === 'smooth' && snapshot) {
        let sum = 0;
        let count = 0;
        for (let oy = -2; oy <= 2; oy++) {
          const sy = clamp(y + oy, 0, height - 1);
          for (let ox = -2; ox <= 2; ox++) {
            const sx = clamp(x + ox, 0, width - 1);
            sum += snapshot[sy * width + sx];
            count++;
          }
        }
        const avg = sum / count;
        depth[idx] = clamp(depth[idx] * (1 - w) + avg * w, 0, 1);
      }
    }
  }

  return true;
}

/**
 * Applies contrast curve around 0.5 pivot to depth buffer.
 */
export function applyDepthContrast(depth: Float32Array, contrast: number): Float32Array {
  if (Math.abs(contrast - 1) < 0.001) return depth;
  const out = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) {
    out[i] = clamp((depth[i] - 0.5) * contrast + 0.5, 0, 1);
  }
  return out;
}

/**
 * Splits a single photograph + depth map into a 3-plane Layered Depth Image (LDI):
 * - Foreground plane (depth >= foregroundCut)
 * - Midground plane (midgroundCut <= depth < foregroundCut)
 * - Background plane (raw hole left where foreground/midground occluded it, ready for inpainting)
 * Also computes a morphologically dilated disocclusion mask so edge halos never leak into the background fill.
 */
export function buildLdiLayers(params: {
  rgba: Uint8ClampedArray;
  depth: Float32Array;
  width: number;
  height: number;
  foregroundCut: number;
  midgroundCut: number;
  feather: number;
  dilationPx?: number;
}): LdiSplitResult {
  const {
    rgba,
    depth,
    width,
    height,
    foregroundCut,
    midgroundCut,
    feather,
    dilationPx = 3,
  } = params;

  const safeMid = clamp(midgroundCut, 0.08, 0.72);
  const safeFg = clamp(foregroundCut, safeMid + 0.1, 0.92);
  const halfFeather = Math.max(0.015, clamp(feather, 0.01, 0.2) * 0.5);

  const total = width * height;
  const backgroundRgba = new Uint8ClampedArray(total * 4);
  const midgroundRgba = new Uint8ClampedArray(total * 4);
  const foregroundRgba = new Uint8ClampedArray(total * 4);
  const rawHole = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const d = depth[i];
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];

    const fgAlpha = smoothstep(safeFg - halfFeather, safeFg + halfFeather, d);
    const midEnter = smoothstep(safeMid - halfFeather, safeMid + halfFeather, d);
    // Midground extends slightly beneath foreground seam (overlap) so parallax doesn't crack
    const midAlpha = clamp(midEnter * (1 - smoothstep(safeFg + halfFeather * 0.6, safeFg + halfFeather * 2.2, d)), 0, 1);

    foregroundRgba[idx] = r;
    foregroundRgba[idx + 1] = g;
    foregroundRgba[idx + 2] = b;
    foregroundRgba[idx + 3] = Math.round(fgAlpha * 255);

    midgroundRgba[idx] = r;
    midgroundRgba[idx + 1] = g;
    midgroundRgba[idx + 2] = b;
    midgroundRgba[idx + 3] = Math.round(midAlpha * 255);

    // Background plate holds real background pixels; occluded areas are marked for disocclusion inpainting
    const isOccluded = d >= safeFg - halfFeather * 0.35;
    if (isOccluded) {
      rawHole[i] = 1;
      backgroundRgba[idx] = 0;
      backgroundRgba[idx + 1] = 0;
      backgroundRgba[idx + 2] = 0;
      backgroundRgba[idx + 3] = 0;
    } else {
      backgroundRgba[idx] = r;
      backgroundRgba[idx + 1] = g;
      backgroundRgba[idx + 2] = b;
      backgroundRgba[idx + 3] = 255;
    }
  }

  // Dilate disocclusion mask slightly to prevent foreground halo fringe from contaminating inpaint boundary
  const disocclusionMask = new Uint8Array(rawHole);
  if (dilationPx > 0) {
    let curr = rawHole;
    let next = new Uint8Array(total);
    for (let step = 0; step < dilationPx; step++) {
      next.set(curr);
      for (let y = 1; y < height - 1; y++) {
        const row = y * width;
        for (let x = 1; x < width - 1; x++) {
          const i = row + x;
          if (
            curr[i] === 1 ||
            curr[i - 1] === 1 ||
            curr[i + 1] === 1 ||
            curr[i - width] === 1 ||
            curr[i + width] === 1
          ) {
            next[i] = 1;
          }
        }
      }
      curr = next;
      next = new Uint8Array(total);
    }
    disocclusionMask.set(curr);
  }

  let holePixelCount = 0;
  for (let i = 0; i < total; i++) {
    if (disocclusionMask[i] === 1) {
      holePixelCount++;
      const idx = i * 4;
      backgroundRgba[idx] = 0;
      backgroundRgba[idx + 1] = 0;
      backgroundRgba[idx + 2] = 0;
      backgroundRgba[idx + 3] = 0;
    }
  }

  return {
    width,
    height,
    backgroundRgba,
    midgroundRgba,
    foregroundRgba,
    disocclusionMask,
    holePixelCount,
    holeCoverageRatio: total > 0 ? holePixelCount / total : 0,
  };
}

/**
 * Multi-pass Disocclusion Inpainting for the Background LDI Plate.
 * Fills holes left behind foreground objects strictly from valid surrounding background pixels:
 * - 'multipass': Fast-marching onion-peel boundary diffusion + horizontal horizon-aware texture synthesis
 * - 'mirror': Nearest valid horizontal/vertical edge pixel stretch
 * - 'none': Leaves holes transparent (great for educational inspection of disocclusion gaps)
 */
export function inpaintBackgroundPlate(params: {
  backgroundRgba: Uint8ClampedArray;
  disocclusionMask: Uint8Array;
  width: number;
  height: number;
  algorithm: InpaintAlgorithm;
  maxIterations?: number;
}): InpaintResult {
  const {
    backgroundRgba,
    disocclusionMask,
    width,
    height,
    algorithm,
    maxIterations = 96,
  } = params;

  const out = new Uint8ClampedArray(backgroundRgba);
  const total = width * height;

  if (algorithm === 'none') {
    return { inpaintedRgba: out, filledPixels: 0, iterations: 0 };
  }

  if (algorithm === 'mirror') {
    let filled = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (disocclusionMask[i] === 0) continue;

        // Search nearest valid pixel horizontally first (preserves sky/horizon bands)
        let srcIdx = -1;
        for (let r = 1; r < width; r++) {
          if (x - r >= 0 && disocclusionMask[row + (x - r)] === 0) {
            srcIdx = row + (x - r);
            break;
          }
          if (x + r < width && disocclusionMask[row + (x + r)] === 0) {
            srcIdx = row + (x + r);
            break;
          }
        }
        // Fallback vertical search if entire row was occluded
        if (srcIdx === -1) {
          for (let r = 1; r < height; r++) {
            if (y - r >= 0 && disocclusionMask[(y - r) * width + x] === 0) {
              srcIdx = (y - r) * width + x;
              break;
            }
            if (y + r < height && disocclusionMask[(y + r) * width + x] === 0) {
              srcIdx = (y + r) * width + x;
              break;
            }
          }
        }
        if (srcIdx !== -1) {
          const dst4 = i * 4;
          const src4 = srcIdx * 4;
          out[dst4] = out[src4];
          out[dst4 + 1] = out[src4 + 1];
          out[dst4 + 2] = out[src4 + 2];
          out[dst4 + 3] = 255;
          filled++;
        }
      }
    }
    return { inpaintedRgba: out, filledPixels: filled, iterations: 1 };
  }

  // 'multipass': Onion-peel Fast Marching / Anisotropic Diffusion strictly from known background pixels
  const known = new Uint8Array(total);
  let remaining = 0;
  for (let i = 0; i < total; i++) {
    if (disocclusionMask[i] === 0) {
      known[i] = 1;
    } else {
      remaining++;
    }
  }

  // Compute global valid background mean as final emergency fallback if entire image were masked
  let meanR = 30;
  let meanG = 35;
  let meanB = 42;
  if (total - remaining > 0) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let cnt = 0;
    for (let i = 0; i < total; i++) {
      if (known[i] === 1) {
        const idx = i * 4;
        sr += out[idx];
        sg += out[idx + 1];
        sb += out[idx + 2];
        cnt++;
      }
    }
    if (cnt > 0) {
      meanR = Math.round(sr / cnt);
      meanG = Math.round(sg / cnt);
      meanB = Math.round(sb / cnt);
    }
  }

  // Neighbor kernel with horizontal preference (horizon & landscape bands stay coherent)
  const offsets: ReadonlyArray<readonly [number, number, number]> = [
    [-1, 0, 1.45],
    [1, 0, 1.45],
    [0, -1, 1.05],
    [0, 1, 0.85],
    [-1, -1, 0.72],
    [1, -1, 0.72],
    [-1, 1, 0.62],
    [1, 1, 0.62],
  ];

  let filledPixels = 0;
  let iterations = 0;
  const newlyKnown = new Uint8Array(total);

  while (remaining > 0 && iterations < maxIterations) {
    iterations++;
    let filledThisPass = 0;
    newlyKnown.fill(0);

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        if (known[i] === 1) continue;

        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let wSum = 0;

        for (let k = 0; k < offsets.length; k++) {
          const nx = x + offsets[k][0];
          const ny = y + offsets[k][1];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (known[nIdx] === 1) {
            const w = offsets[k][2];
            const n4 = nIdx * 4;
            rSum += out[n4] * w;
            gSum += out[n4 + 1] * w;
            bSum += out[n4 + 2] * w;
            wSum += w;
          }
        }

        if (wSum > 0) {
          const dst4 = i * 4;
          // Tiny deterministic grain breaks up flat gradients on wide holes
          const grain = (((x * 37 + y * 17 + iterations * 13) % 7) - 3) * 0.7;
          out[dst4] = clamp(Math.round(rSum / wSum + grain), 0, 255);
          out[dst4 + 1] = clamp(Math.round(gSum / wSum + grain), 0, 255);
          out[dst4 + 2] = clamp(Math.round(bSum / wSum + grain), 0, 255);
          out[dst4 + 3] = 255;
          newlyKnown[i] = 1;
          filledThisPass++;
        }
      }
    }

    if (filledThisPass === 0) break;

    for (let i = 0; i < total; i++) {
      if (newlyKnown[i] === 1) {
        known[i] = 1;
      }
    }
    filledPixels += filledThisPass;
    remaining -= filledThisPass;
  }

  // Fill any unreachable interior pixels with mean valid background color
  if (remaining > 0) {
    for (let i = 0; i < total; i++) {
      if (known[i] === 0) {
        const dst4 = i * 4;
        out[dst4] = meanR;
        out[dst4 + 1] = meanG;
        out[dst4 + 2] = meanB;
        out[dst4 + 3] = 255;
        filledPixels++;
      }
    }
  }

  // Final 2-pass gentle relaxation strictly inside filled disocclusion pixels to eliminate seam steps
  const temp = new Uint8ClampedArray(out);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = row + x;
        if (disocclusionMask[i] === 0) continue;
        const c = i * 4;
        const l = (i - 1) * 4;
        const r = (i + 1) * 4;
        const u = (i - width) * 4;
        const d = (i + width) * 4;
        temp[c] = (out[c] * 2 + out[l] + out[r] + out[u] + out[d]) / 6;
        temp[c + 1] = (out[c + 1] * 2 + out[l + 1] + out[r + 1] + out[u + 1] + out[d + 1]) / 6;
        temp[c + 2] = (out[c + 2] * 2 + out[l + 2] + out[r + 2] + out[u + 2] + out[d + 2]) / 6;
        temp[c + 3] = 255;
      }
    }
    out.set(temp);
  }

  return { inpaintedRgba: out, filledPixels, iterations };
}

/**
 * Converts normalized [0..1] depth buffer into an RGBA Turbo/Inferno-inspired heatmap
 * for clear visual depth inspection (deep indigo = far, amber/gold = mid, crisp white = near).
 */
export function depthBufferToHeatmapRgba(depth: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(depth.length * 4);
  for (let i = 0; i < depth.length; i++) {
    const v = clamp(depth[i], 0, 1);
    let r = 0;
    let g = 0;
    let b = 0;

    if (v < 0.25) {
      const t = v / 0.25;
      r = 12 + t * 40;
      g = 18 + t * 38;
      b = 46 + t * 94;
    } else if (v < 0.55) {
      const t = (v - 0.25) / 0.3;
      r = 52 + t * 145;
      g = 56 + t * 52;
      b = 140 - t * 62;
    } else if (v < 0.85) {
      const t = (v - 0.55) / 0.3;
      r = 197 + t * 48;
      g = 108 + t * 98;
      b = 78 - t * 24;
    } else {
      const t = (v - 0.85) / 0.15;
      r = 245 + t * 10;
      g = 206 + t * 49;
      b = 54 + t * 192;
    }

    const idx = i * 4;
    out[idx] = clamp(Math.round(r), 0, 255);
    out[idx + 1] = clamp(Math.round(g), 0, 255);
    out[idx + 2] = clamp(Math.round(b), 0, 255);
    out[idx + 3] = 255;
  }
  return out;
}

/**
 * Converts normalized [0..1] depth buffer into standard grayscale RGBA texture.
 */
export function depthBufferToGrayscaleRgba(depth: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(depth.length * 4);
  for (let i = 0; i < depth.length; i++) {
    const byte = Math.round(clamp(depth[i], 0, 1) * 255);
    const idx = i * 4;
    out[idx] = byte;
    out[idx + 1] = byte;
    out[idx + 2] = byte;
    out[idx + 3] = 255;
  }
  return out;
}

/**
 * Converts binary disocclusion hole mask into high-contrast diagnostic RGBA preview.
 */
export function disocclusionMaskToRgba(mask: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const idx = i * 4;
    if (mask[i] === 1) {
      out[idx] = 229;
      out[idx + 1] = 152;
      out[idx + 2] = 56;
      out[idx + 3] = 255;
    } else {
      out[idx] = 20;
      out[idx + 1] = 24;
      out[idx + 2] = 32;
      out[idx + 3] = 255;
    }
  }
  return out;
}
