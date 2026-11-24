import type {
  AtmosphereMode,
  CameraMotionPreset,
  CameraRigState,
  DepthBrushTool,
  DepthRegionSpec,
  InpaintAlgorithm,
  InpaintResult,
  LdiSplitResult,
  SceneDepthBlueprint,
  StudioScenePreset,
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
      offsetX = Math.sin(t * 0.72) * 0.24 * amp;
      offsetY = Math.cos(t * 0.72) * 0.12 * amp;
      dollyZ = Math.sin(t * 0.36) * 0.06 * amp;
      yaw = offsetX * 0.14;
      pitch = -offsetY * 0.12;
      break;
    }
    case 'dolly-zoom': {
      // Classic Vertigo / Hitchcock camera rig:
      // Move camera along Z while adjusting FOV so frustum height at focal distance stays constant:
      // tan(fov/2) * distance = constant
      const wave = Math.sin(t * 0.65);
      dollyZ = wave * 0.65 * amp;
      const currentDist = Math.max(1.2, baseDistance + dollyZ);
      const baseHalfHeight = Math.tan((baseFovDeg * Math.PI) / 360) * baseDistance;
      fov = (2 * Math.atan(baseHalfHeight / currentDist) * 180) / Math.PI;
      fov = clamp(fov, 18, 72);
      offsetX = Math.sin(t * 0.325) * 0.07 * amp;
      offsetY = Math.cos(t * 0.325) * 0.035 * amp;
      yaw = offsetX * 0.08;
      break;
    }
    case 'truck': {
      offsetX = Math.sin(t * 0.62) * 0.3 * amp;
      offsetY = Math.sin(t * 1.24) * 0.018 * amp;
      yaw = offsetX * 0.16;
      break;
    }
    case 'ken-burns': {
      const cycle = 0.5 - 0.5 * Math.cos(t * 0.48);
      dollyZ = -cycle * 0.4 * amp;
      offsetX = (cycle - 0.5) * 0.2 * amp;
      offsetY = (cycle - 0.5) * 0.08 * amp;
      yaw = offsetX * 0.1;
      break;
    }
    case 'breathe': {
      offsetX = (Math.sin(t * 0.46) * 0.12 + Math.sin(t * 1.08) * 0.03) * amp;
      offsetY = (Math.cos(t * 0.58) * 0.09 + Math.sin(t * 0.91) * 0.025) * amp;
      dollyZ = Math.sin(t * 0.39) * 0.08 * amp;
      roll = Math.sin(t * 0.33) * 0.012 * amp;
      yaw = offsetX * 0.1;
      pitch = -offsetY * 0.08;
      break;
    }
    case 'pointer': {
      offsetX = clamp(pointerX, -1, 1) * 0.28 * amp;
      offsetY = clamp(pointerY, -1, 1) * 0.18 * amp;
      yaw = offsetX * 0.15;
      pitch = -offsetY * 0.12;
      break;
    }
  }

  return { offsetX, offsetY, dollyZ, fov, yaw, pitch, roll };
}

/**
 * Signed distance to a normalized 2D polygon:
 * Negative inside polygon, positive outside polygon.
 */
function signedDistanceToPolygon(
  x: number,
  y: number,
  points: ReadonlyArray<readonly [number, number]>,
): number {
  let inside = false;
  let minDistSq = Infinity;
  const n = points.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;

    const dx = xj - xi;
    const dy = yj - yi;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 1e-9 ? clamp(((x - xi) * dx + (y - yi) * dy) / lenSq, 0, 1) : 0;
    const px = xi + t * dx;
    const py = yi + t * dy;
    const distSq = (x - px) * (x - px) + (y - py) * (y - py);
    if (distSq < minDistSq) minDistSq = distSq;
  }

  const dist = Math.sqrt(minDistSq);
  return inside ? -dist : dist;
}

/**
 * Computes fast O(N) separable box-mean filter over a Float32Array buffer.
 */
function boxFilterMean(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const horiz = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  // Horizontal pass with sliding window
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, radius); x++) {
      sum += src[row + x];
      count++;
    }
    for (let x = 0; x < width; x++) {
      horiz[row + x] = sum / count;
      const addX = x + radius + 1;
      const remX = x - radius;
      if (addX < width) {
        sum += src[row + addX];
        count++;
      }
      if (remX >= 0) {
        sum -= src[row + remX];
        count--;
      }
    }
  }

  // Vertical pass with sliding window
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, radius); y++) {
      sum += horiz[y * width + x];
      count++;
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / count;
      const addY = y + radius + 1;
      const remY = y - radius;
      if (addY < height) {
        sum += horiz[addY * width + x];
        count++;
      }
      if (remY >= 0) {
        sum -= horiz[remY * width + x];
        count--;
      }
    }
  }

  return out;
}

/**
 * Runs a single-channel O(N) Guided Image Filter (He et al., ECCV 2010)
 * and returns both the filtered output and the per-pixel local guide variance.
 */
function guidedFilterChannel(
  depth: Float32Array,
  guide: Float32Array,
  width: number,
  height: number,
  radius: number,
  eps: number,
): { out: Float32Array; variance: Float32Array } {
  const total = width * height;
  const ii = new Float32Array(total);
  const ip = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const g = guide[i];
    ii[i] = g * g;
    ip[i] = g * depth[i];
  }

  const meanI = boxFilterMean(guide, width, height, radius);
  const meanP = boxFilterMean(depth, width, height, radius);
  const meanII = boxFilterMean(ii, width, height, radius);
  const meanIP = boxFilterMean(ip, width, height, radius);

  const a = new Float32Array(total);
  const b = new Float32Array(total);
  const variance = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const varI = Math.max(0, meanII[i] - meanI[i] * meanI[i]);
    variance[i] = varI;
    const covIP = meanIP[i] - meanI[i] * meanP[i];
    const ai = covIP / (varI + eps);
    a[i] = ai;
    b[i] = meanP[i] - ai * meanI[i];
  }

  const meanA = boxFilterMean(a, width, height, radius);
  const meanB = boxFilterMean(b, width, height, radius);

  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    out[i] = clamp(meanA[i] * guide[i] + meanB[i], 0, 1);
  }
  return { out, variance };
}

/**
 * Industry-standard O(N) 3-Channel RGB Guided Image Filter.
 * Evaluates R, G, and B photographic guidance channels and fuses them by local channel
 * variance, snapping depth maps razor-tight to ANY silhouette (luminance OR isoluminant
 * red/green/blue/skin-tone boundaries) without tearing shaded interiors.
 */
export function guidedFilterDepth(
  depth: Float32Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  radius = 6,
  eps = 0.0022,
): Float32Array {
  const total = width * height;
  const rGuide = new Float32Array(total);
  const gGuide = new Float32Array(total);
  const bGuide = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    rGuide[i] = rgba[idx] / 255;
    gGuide[i] = rgba[idx + 1] / 255;
    bGuide[i] = rgba[idx + 2] / 255;
  }

  const rRes = guidedFilterChannel(depth, rGuide, width, height, radius, eps);
  const gRes = guidedFilterChannel(depth, gGuide, width, height, radius, eps);
  const bRes = guidedFilterChannel(depth, bGuide, width, height, radius, eps);

  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const wR = rRes.variance[i] + 0.00015;
    const wG = gRes.variance[i] + 0.00015;
    const wB = bRes.variance[i] + 0.00015;
    out[i] = clamp(
      (rRes.out[i] * wR + gRes.out[i] * wG + bRes.out[i] * wB) / (wR + wG + wB),
      0,
      1,
    );
  }
  return out;
}

interface CompiledRegionModel {
  reg: DepthRegionSpec;
  minY: number;
  maxY: number;
  coreR: number;
  coreG: number;
  coreB: number;
  bgR: number;
  bgG: number;
  bgB: number;
  hasBgRef: boolean;
}

/**
 * Synthesizes a normalized [0..1] depth map (1 = near foreground, 0 = far background)
 * from an RGBA image buffer and optional semantic depth blueprint.
 * Combines continuous perspective planes, polygon/ellipse regions, luminance-gated silhouette
 * separation, and the O(N) Guided Image Filter for crisp edge alignment.
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
  const groundSlope = blueprint?.groundSlope ?? 0.44;
  const edgeWeight = blueprint?.edgeWeight ?? 0.08;
  const horizontalTilt = blueprint?.horizontalTilt ?? 0;
  const regions = blueprint?.regions ?? [];

  const regionModels: CompiledRegionModel[] = regions.map((reg) => {
    let minY = clamp(reg.cy - reg.ry, 0, 1);
    let maxY = clamp(reg.cy + reg.ry, 0, 1);
    if (reg.shape === 'polygon' && reg.points && reg.points.length >= 3) {
      minY = 1;
      maxY = 0;
      for (const pt of reg.points) {
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      }
      minY = clamp(minY, 0, 1);
      maxY = clamp(maxY, 0, 1);
    }

    let coreR = 0,
      coreG = 0,
      coreB = 0,
      coreCnt = 0;
    let bgR = 0,
      bgG = 0,
      bgB = 0,
      bgCnt = 0;

    if (reg.autoSkyMatte) {
      const cxPx = clamp(Math.round(reg.cx * (width - 1)), 0, width - 1);
      const cyPx = clamp(Math.round(reg.cy * (height - 1)), 0, height - 1);
      const sampleRadX = Math.max(1, Math.round(reg.rx * width * 0.25));
      const sampleRadY = Math.max(1, Math.round(reg.ry * height * 0.25));
      for (let dy = -sampleRadY; dy <= sampleRadY; dy += Math.max(1, Math.floor(sampleRadY / 3))) {
        const sy = clamp(cyPx + dy, 0, height - 1);
        for (let dx = -sampleRadX; dx <= sampleRadX; dx += Math.max(1, Math.floor(sampleRadX / 3))) {
          const sx = clamp(cxPx + dx, 0, width - 1);
          const p = (sy * width + sx) * 4;
          coreR += rgba[p] / 255;
          coreG += rgba[p + 1] / 255;
          coreB += rgba[p + 2] / 255;
          coreCnt++;
        }
      }
      if (coreCnt > 0) {
        coreR /= coreCnt;
        coreG /= coreCnt;
        coreB /= coreCnt;
      }

      const angles = 12;
      for (let a = 0; a < angles; a++) {
        const theta = (a / angles) * Math.PI * 2;
        const ox = Math.round((reg.cx + Math.cos(theta) * reg.rx * 1.28) * (width - 1));
        const oy = Math.round((reg.cy + Math.sin(theta) * reg.ry * 1.28) * (height - 1));
        if (ox < 0 || ox >= width || oy < 0 || oy >= height) continue;
        if (oy > cyPx + reg.ry * height * 0.45) continue;
        const p = (oy * width + ox) * 4;
        bgR += rgba[p] / 255;
        bgG += rgba[p + 1] / 255;
        bgB += rgba[p + 2] / 255;
        bgCnt++;
      }
      if (bgCnt > 0) {
        bgR /= bgCnt;
        bgG /= bgCnt;
        bgB /= bgCnt;
      }
    }

    const contrastGap =
      bgCnt > 0 ? Math.hypot(coreR - bgR, coreG - bgG, coreB - bgB) : 0;

    return {
      reg,
      minY,
      maxY,
      coreR,
      coreG,
      coreB,
      bgR,
      bgG,
      bgB,
      hasBgRef: Boolean(reg.autoSkyMatte) && bgCnt >= 2 && contrastGap > 0.14,
    };
  });

  for (let y = 0; y < height; y++) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const nx = x / Math.max(1, width - 1);
      const p = y * width + x;

      // 1. Continuous architectural/landscape perspective baseline
      let d: number;
      if (ny < horizonY) {
        d = 0.08 + 0.14 * (ny / Math.max(0.01, horizonY));
      } else {
        const groundT = (ny - horizonY) / Math.max(0.01, 1 - horizonY);
        d = 0.22 + Math.pow(groundT, 1.1) * groundSlope;
      }
      if (horizontalTilt !== 0) {
        d += (0.5 - nx) * horizontalTilt;
      }

      // 2. Subtle local edge & aerial perspective cues
      const xm = x > 0 ? x - 1 : x;
      const xp = x < width - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y;
      const yp = y < height - 1 ? y + 1 : y;
      const gx = Math.abs(luma[y * width + xp] - luma[y * width + xm]);
      const gy = Math.abs(luma[yp * width + x] - luma[ym * width + x]);
      const edge = clamp((gx + gy) * 1.2, 0, 1);

      const idx = p * 4;
      const r = rgba[idx] / 255;
      const g = rgba[idx + 1] / 255;
      const b = rgba[idx + 2] / 255;
      const pxLuma = luma[p];

      d = clamp(d + edge * edgeWeight, 0.04, 0.96);

      // 3. Semantic blueprint regions (polygons, ellipses, rects, vertical depth gradients, luminance gates)
      for (let rIdx = 0; rIdx < regionModels.length; rIdx++) {
        const model = regionModels[rIdx];
        const reg = model.reg;
        const soft = Math.max(0.012, reg.softness);

        let spatialInfluence = 0;
        let radialDist = 1;

        if (reg.shape === 'polygon' && reg.points && reg.points.length >= 3) {
          const sd = signedDistanceToPolygon(nx, ny, reg.points);
          spatialInfluence = 1 - smoothstep(-soft, soft, sd);
          radialDist = sd < 0 ? 0.2 : 1.0;
        } else if (reg.shape === 'rect') {
          const dx = Math.abs(nx - reg.cx) / Math.max(0.01, reg.rx);
          const dy = Math.abs(ny - reg.cy) / Math.max(0.01, reg.ry);
          radialDist = Math.max(dx, dy);
          spatialInfluence = 1 - smoothstep(1 - soft * 2.0, 1 + soft * 2.0, radialDist);
        } else {
          const dx = (nx - reg.cx) / Math.max(0.01, reg.rx);
          const dy = (ny - reg.cy) / Math.max(0.01, reg.ry);
          radialDist = Math.sqrt(dx * dx + dy * dy);
          spatialInfluence = 1 - smoothstep(1 - soft * 2.0, 1 + soft * 2.0, radialDist);
        }

        if (spatialInfluence <= 0.001) continue;

        let matteWeight = spatialInfluence;

        // Optional luminance upper-bound gating (e.g. dark wooden easel or olive foliage in front of bright window/curtains)
        if (typeof reg.lumaMax === 'number') {
          const lumaGate = 1 - smoothstep(reg.lumaMax - 0.08, reg.lumaMax + 0.12, pxLuma);
          matteWeight *= lumaGate;
        }
        // Optional luminance lower-bound gating (e.g. bright window view strictly behind dark mullions)
        if (typeof reg.lumaMin === 'number') {
          const lumaGate = smoothstep(reg.lumaMin - 0.1, reg.lumaMin + 0.08, pxLuma);
          matteWeight *= lumaGate;
        }
        // Optional excess-green foliage gating (separates olive/tree leaves from dark neutral walls/curtains)
        if (typeof reg.greenMin === 'number') {
          const excessGreen = g - (r * 0.56 + b * 0.44);
          const greenGate = smoothstep(reg.greenMin - 0.018, reg.greenMin + 0.025, excessGreen);
          matteWeight *= greenGate;
        }
        // Optional HSV saturation gate (separates vibrant subjects from neutral gray/white backgrounds)
        if (typeof reg.satMin === 'number') {
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC > 0.001 ? (maxC - minC) / maxC : 0;
          const satGate = smoothstep(reg.satMin - 0.08, reg.satMin + 0.08, sat);
          matteWeight *= satGate;
        }
        // Optional universal RGB color-key matting (matches or excludes any target color)
        if (Array.isArray(reg.colorTarget) && reg.colorTarget.length === 3) {
          const norm = (c: number) => (c > 1 ? clamp(c / 255, 0, 1) : clamp(c, 0, 1));
          const tr = norm(reg.colorTarget[0]);
          const tg = norm(reg.colorTarget[1]);
          const tb = norm(reg.colorTarget[2]);
          const dist = Math.hypot(r - tr, g - tg, b - tb);
          const tol = clamp(reg.colorTolerance ?? 0.25, 0.04, 1.2);
          const colorMatch = 1 - smoothstep(tol * 0.65, tol * 1.35, dist);
          matteWeight *= reg.invertColorTarget ? 1 - colorMatch : colorMatch;
        }

        // Optional automatic foreground-vs-sky color matting for outdoor silhouettes
        if (model.hasBgRef) {
          const distToFg = Math.hypot(r - model.coreR, g - model.coreG, b - model.coreB);
          const distToBg = Math.hypot(r - model.bgR, g - model.bgG, b - model.bgB);
          const fgAffinity = smoothstep(-0.08, 0.18, distToBg - distToFg * 0.78);
          const coreProtect = 1 - smoothstep(0.18, 0.52, radialDist);
          matteWeight *= Math.max(coreProtect * fgAffinity, fgAffinity);
        }

        if (matteWeight > 0.001) {
          // Support smooth vertical perspective slope inside any region (e.g., receding tables, floors, pathways)
          let targetDepth = reg.depth;
          if (typeof reg.depthBottom === 'number') {
            const span = Math.max(0.02, model.maxY - model.minY);
            const ty = clamp((ny - model.minY) / span, 0, 1);
            targetDepth = reg.depth + (reg.depthBottom - reg.depth) * ty;
          }
          d = d * (1 - matteWeight) + clamp(targetDepth, 0.03, 0.99) * matteWeight;
        }
      }

      depth[p] = clamp(d, 0, 1);
    }
  }

  const gRadius = clamp(Math.round(blueprint?.guidedRadius ?? 6), 1, 16);
  const gEps = clamp(blueprint?.guidedEps ?? 0.0022, 0.0005, 0.05);
  // Apply O(N) 3-Channel RGB Guided Image Filter to snap depth edges onto true visual contours
  return guidedFilterDepth(depth, rgba, width, height, gRadius, gEps);
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
 * - Background plane (raw hole left where foreground occluded it, ready for inpainting)
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
    const midAlpha = clamp(
      midEnter * (1 - smoothstep(safeFg + halfFeather * 0.6, safeFg + halfFeather * 2.2, d)),
      0,
      1,
    );

    foregroundRgba[idx] = r;
    foregroundRgba[idx + 1] = g;
    foregroundRgba[idx + 2] = b;
    foregroundRgba[idx + 3] = Math.round(fgAlpha * 255);

    midgroundRgba[idx] = r;
    midgroundRgba[idx + 1] = g;
    midgroundRgba[idx + 2] = b;
    midgroundRgba[idx + 3] = Math.round(midAlpha * 255);

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
 * Fills holes left behind foreground objects strictly from valid surrounding background pixels.
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

  // 'multipass': Onion-peel anisotropic diffusion strictly from known background pixels
  const known = new Uint8Array(total);
  let remaining = 0;
  for (let i = 0; i < total; i++) {
    if (disocclusionMask[i] === 0) {
      known[i] = 1;
    } else {
      remaining++;
    }
  }

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

  // Stronger horizontal continuity weights so horizons, curtains, walls, and floors flow naturally
  const offsets: ReadonlyArray<readonly [number, number, number]> = [
    [-1, 0, 1.85],
    [1, 0, 1.85],
    [0, -1, 0.95],
    [0, 1, 0.8],
    [-1, -1, 0.65],
    [1, -1, 0.65],
    [-1, 1, 0.55],
    [1, 1, 0.55],
  ];

  // Build a smooth Multi-Scale Push-Pull Pyramid strictly from known background pixels
  // so large interior holes get globally coherent tones without sharp diagonal front-collision creases
  const pushPullRgb = buildPushPullFill(out, disocclusionMask, width, height, meanR, meanG, meanB);

  let filledPixels = 0;
  let iterations = 0;
  const newlyKnown = new Uint8Array(total);
  const depthFromBoundary = new Uint16Array(total);

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
          const grain = (((x * 37 + y * 17 + iterations * 13) % 7) - 3) * 0.35;
          out[dst4] = clamp(Math.round(rSum / wSum + grain), 0, 255);
          out[dst4 + 1] = clamp(Math.round(gSum / wSum + grain), 0, 255);
          out[dst4 + 2] = clamp(Math.round(bSum / wSum + grain), 0, 255);
          out[dst4 + 3] = 255;
          newlyKnown[i] = 1;
          depthFromBoundary[i] = iterations;
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

  if (remaining > 0) {
    for (let i = 0; i < total; i++) {
      if (known[i] === 0) {
        const dst4 = i * 4;
        out[dst4] = pushPullRgb[dst4];
        out[dst4 + 1] = pushPullRgb[dst4 + 1];
        out[dst4 + 2] = pushPullRgb[dst4 + 2];
        out[dst4 + 3] = 255;
        depthFromBoundary[i] = maxIterations;
        filledPixels++;
      }
    }
  }

  // Blend deep interior hole pixels smoothly toward the multi-scale push-pull field
  // (keeps crisp boundary continuity near edges while erasing interior diagonal creases)
  for (let i = 0; i < total; i++) {
    if (disocclusionMask[i] === 0) continue;
    const dist = depthFromBoundary[i];
    if (dist <= 2) continue;
    const blend = smoothstep(2, 16, dist) * 0.55;
    const c = i * 4;
    out[c] = Math.round(out[c] * (1 - blend) + pushPullRgb[c] * blend);
    out[c + 1] = Math.round(out[c + 1] * (1 - blend) + pushPullRgb[c + 1] * blend);
    out[c + 2] = Math.round(out[c + 2] * (1 - blend) + pushPullRgb[c + 2] * blend);
  }

  // 6-pass smooth anisotropic harmonic relaxation strictly inside filled disocclusion holes
  const temp = new Uint8ClampedArray(out);
  for (let pass = 0; pass < 6; pass++) {
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
        temp[c] = (out[c] * 2 + out[l] * 1.45 + out[r] * 1.45 + out[u] + out[d]) / 6.9;
        temp[c + 1] = (out[c + 1] * 2 + out[l + 1] * 1.45 + out[r + 1] * 1.45 + out[u + 1] + out[d + 1]) / 6.9;
        temp[c + 2] = (out[c + 2] * 2 + out[l + 2] * 1.45 + out[r + 2] * 1.45 + out[u + 2] + out[d + 2]) / 6.9;
        temp[c + 3] = 255;
      }
    }
    out.set(temp);
  }

  return { inpaintedRgba: out, filledPixels, iterations };
}

/**
 * Multi-Scale Push-Pull Pyramid (Gortler et al.) over valid background pixels only.
 * Pulls valid colors down to coarse scales until every hole has valid support,
 * then pushes smooth bilinear interpolations back up to fill wide holes cleanly.
 */
function buildPushPullFill(
  rgba: Uint8ClampedArray,
  disocclusionMask: Uint8Array,
  width: number,
  height: number,
  fallbackR: number,
  fallbackG: number,
  fallbackB: number,
): Uint8ClampedArray {
  interface PyramidLevel {
    w: number;
    h: number;
    r: Float32Array;
    g: Float32Array;
    b: Float32Array;
    a: Float32Array;
  }

  const total0 = width * height;
  const lvl0: PyramidLevel = {
    w: width,
    h: height,
    r: new Float32Array(total0),
    g: new Float32Array(total0),
    b: new Float32Array(total0),
    a: new Float32Array(total0),
  };

  for (let i = 0; i < total0; i++) {
    if (disocclusionMask[i] === 0) {
      const idx = i * 4;
      lvl0.r[i] = rgba[idx];
      lvl0.g[i] = rgba[idx + 1];
      lvl0.b[i] = rgba[idx + 2];
      lvl0.a[i] = 1;
    }
  }

  const levels: PyramidLevel[] = [lvl0];
  let curr = lvl0;
  // Pull phase (downsample up to 5 levels)
  for (let step = 0; step < 5 && (curr.w > 4 || curr.h > 4); step++) {
    const nw = Math.max(2, Math.ceil(curr.w / 2));
    const nh = Math.max(2, Math.ceil(curr.h / 2));
    const next: PyramidLevel = {
      w: nw,
      h: nh,
      r: new Float32Array(nw * nh),
      g: new Float32Array(nw * nh),
      b: new Float32Array(nw * nh),
      a: new Float32Array(nw * nh),
    };

    for (let y = 0; y < nh; y++) {
      const sy0 = Math.min(curr.h - 1, y * 2);
      const sy1 = Math.min(curr.h - 1, sy0 + 1);
      for (let x = 0; x < nw; x++) {
        const sx0 = Math.min(curr.w - 1, x * 2);
        const sx1 = Math.min(curr.w - 1, sx0 + 1);
        const idxs = [
          sy0 * curr.w + sx0,
          sy0 * curr.w + sx1,
          sy1 * curr.w + sx0,
          sy1 * curr.w + sx1,
        ];
        let sr = 0,
          sg = 0,
          sb = 0,
          sa = 0;
        for (let k = 0; k < 4; k++) {
          const p = idxs[k];
          const w = curr.a[p];
          if (w > 0) {
            sr += curr.r[p] * w;
            sg += curr.g[p] * w;
            sb += curr.b[p] * w;
            sa += w;
          }
        }
        const dst = y * nw + x;
        if (sa > 0.0001) {
          next.r[dst] = sr / sa;
          next.g[dst] = sg / sa;
          next.b[dst] = sb / sa;
          next.a[dst] = Math.min(1, sa * 0.5);
        }
      }
    }
    levels.push(next);
    curr = next;
  }

  // Ensure coarsest level has valid fallback everywhere
  const top = levels[levels.length - 1];
  for (let i = 0; i < top.w * top.h; i++) {
    if (top.a[i] <= 0.0001) {
      top.r[i] = fallbackR;
      top.g[i] = fallbackG;
      top.b[i] = fallbackB;
      top.a[i] = 1;
    }
  }

  // Push phase (bilinear upsample coarse colors into missing pixels at finer levels)
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y++) {
      const gy = (y / Math.max(1, fine.h - 1)) * (coarse.h - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(coarse.h - 1, y0 + 1);
      const fy = gy - y0;
      for (let x = 0; x < fine.w; x++) {
        const dst = y * fine.w + x;
        if (fine.a[dst] >= 0.999) continue;

        const gx = (x / Math.max(1, fine.w - 1)) * (coarse.w - 1);
        const x0 = Math.floor(gx);
        const x1 = Math.min(coarse.w - 1, x0 + 1);
        const fx = gx - x0;

        const i00 = y0 * coarse.w + x0;
        const i10 = y0 * coarse.w + x1;
        const i01 = y1 * coarse.w + x0;
        const i11 = y1 * coarse.w + x1;

        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const cr = coarse.r[i00] * w00 + coarse.r[i10] * w10 + coarse.r[i01] * w01 + coarse.r[i11] * w11;
        const cg = coarse.g[i00] * w00 + coarse.g[i10] * w10 + coarse.g[i01] * w01 + coarse.g[i11] * w11;
        const cb = coarse.b[i00] * w00 + coarse.b[i10] * w10 + coarse.b[i01] * w01 + coarse.b[i11] * w11;

        const keep = fine.a[dst];
        fine.r[dst] = fine.r[dst] * keep + cr * (1 - keep);
        fine.g[dst] = fine.g[dst] * keep + cg * (1 - keep);
        fine.b[dst] = fine.b[dst] * keep + cb * (1 - keep);
        fine.a[dst] = 1;
      }
    }
  }

  const out = new Uint8ClampedArray(total0 * 4);
  for (let i = 0; i < total0; i++) {
    const idx = i * 4;
    out[idx] = clamp(Math.round(lvl0.r[i]), 0, 255);
    out[idx + 1] = clamp(Math.round(lvl0.g[i]), 0, 255);
    out[idx + 2] = clamp(Math.round(lvl0.b[i]), 0, 255);
    out[idx + 3] = 255;
  }
  return out;
}

const VALID_MOTIONS: ReadonlySet<CameraMotionPreset> = new Set([
  'orbit',
  'dolly-zoom',
  'truck',
  'ken-burns',
  'breathe',
  'pointer',
]);

const VALID_ATMOS: ReadonlySet<AtmosphereMode> = new Set(['none', 'dust', 'mist', 'rain']);

function parseDepthRegion(raw: unknown): DepthRegionSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const shape = r.shape === 'rect' || r.shape === 'polygon' ? r.shape : 'ellipse';
  const layer =
    r.layer === 'foreground' || r.layer === 'background' ? r.layer : 'midground';
  const depth = typeof r.depth === 'number' && Number.isFinite(r.depth) ? clamp(r.depth, 0.02, 0.99) : null;
  if (depth === null) return null;

  let points: Array<[number, number]> | undefined;
  if (shape === 'polygon') {
    if (!Array.isArray(r.points) || r.points.length < 3) return null;
    points = [];
    for (const pt of r.points) {
      if (
        !Array.isArray(pt) ||
        pt.length < 2 ||
        typeof pt[0] !== 'number' ||
        typeof pt[1] !== 'number'
      ) {
        return null;
      }
      points.push([pt[0], pt[1]]);
    }
  }

  let colorTarget: [number, number, number] | undefined;
  if (
    Array.isArray(r.colorTarget) &&
    r.colorTarget.length === 3 &&
    r.colorTarget.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    colorTarget = [r.colorTarget[0], r.colorTarget[1], r.colorTarget[2]];
  }

  return {
    label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : 'Зона глубины',
    layer,
    shape,
    cx: typeof r.cx === 'number' && Number.isFinite(r.cx) ? r.cx : 0.5,
    cy: typeof r.cy === 'number' && Number.isFinite(r.cy) ? r.cy : 0.5,
    rx: typeof r.rx === 'number' && Number.isFinite(r.rx) ? Math.max(0.01, r.rx) : 0.2,
    ry: typeof r.ry === 'number' && Number.isFinite(r.ry) ? Math.max(0.01, r.ry) : 0.2,
    ...(points ? { points } : {}),
    depth,
    ...(typeof r.depthBottom === 'number' && Number.isFinite(r.depthBottom)
      ? { depthBottom: clamp(r.depthBottom, 0.02, 0.99) }
      : {}),
    softness:
      typeof r.softness === 'number' && Number.isFinite(r.softness)
        ? clamp(r.softness, 0.008, 0.35)
        : 0.04,
    ...(typeof r.lumaMax === 'number' && Number.isFinite(r.lumaMax)
      ? { lumaMax: clamp(r.lumaMax, 0, 1) }
      : {}),
    ...(typeof r.lumaMin === 'number' && Number.isFinite(r.lumaMin)
      ? { lumaMin: clamp(r.lumaMin, 0, 1) }
      : {}),
    ...(typeof r.greenMin === 'number' && Number.isFinite(r.greenMin)
      ? { greenMin: clamp(r.greenMin, -0.2, 0.5) }
      : {}),
    ...(typeof r.satMin === 'number' && Number.isFinite(r.satMin)
      ? { satMin: clamp(r.satMin, 0, 1) }
      : {}),
    ...(colorTarget ? { colorTarget } : {}),
    ...(typeof r.colorTolerance === 'number' && Number.isFinite(r.colorTolerance)
      ? { colorTolerance: clamp(r.colorTolerance, 0.04, 1.2) }
      : {}),
    ...(typeof r.invertColorTarget === 'boolean'
      ? { invertColorTarget: r.invertColorTarget }
      : {}),
    ...(typeof r.autoSkyMatte === 'boolean' ? { autoSkyMatte: r.autoSkyMatte } : {}),
  };
}

export function parseAndValidateBlueprint(
  raw: unknown,
): { ok: true; blueprint: SceneDepthBlueprint } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Blueprint должен быть JSON-объектом.' };
  }
  const obj = raw as Record<string, unknown>;
  const rawRegions = Array.isArray(obj.regions) ? obj.regions : [];
  const regions: DepthRegionSpec[] = [];
  for (let i = 0; i < rawRegions.length; i++) {
    const parsed = parseDepthRegion(rawRegions[i]);
    if (!parsed) {
      return {
        ok: false,
        error: `Некорректная зона regions[${i}]: проверьте поля depth и points (для polygon ≥ 3 точек).`,
      };
    }
    regions.push(parsed);
  }

  return {
    ok: true,
    blueprint: {
      horizonY:
        typeof obj.horizonY === 'number' && Number.isFinite(obj.horizonY)
          ? clamp(obj.horizonY, 0.05, 0.95)
          : 0.42,
      groundSlope:
        typeof obj.groundSlope === 'number' && Number.isFinite(obj.groundSlope)
          ? clamp(obj.groundSlope, 0, 0.9)
          : 0.4,
      edgeWeight:
        typeof obj.edgeWeight === 'number' && Number.isFinite(obj.edgeWeight)
          ? clamp(obj.edgeWeight, 0, 0.4)
          : 0.07,
      ...(typeof obj.horizontalTilt === 'number' && Number.isFinite(obj.horizontalTilt)
        ? { horizontalTilt: clamp(obj.horizontalTilt, -0.4, 0.4) }
        : {}),
      ...(typeof obj.guidedRadius === 'number' && Number.isFinite(obj.guidedRadius)
        ? { guidedRadius: clamp(Math.round(obj.guidedRadius), 1, 16) }
        : {}),
      ...(typeof obj.guidedEps === 'number' && Number.isFinite(obj.guidedEps)
        ? { guidedEps: clamp(obj.guidedEps, 0.0005, 0.05) }
        : {}),
      regions,
    },
  };
}

/**
 * Validates a full declarative Scene Manifest JSON (src/scenes/*.json or pasted runtime recipe).
 */
export function parseAndValidateSceneManifest(
  raw: unknown,
): { ok: true; manifest: StudioScenePreset } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Манифест сцены должен быть JSON-объектом.' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) {
    return { ok: false, error: 'Отсутствует строковое поле "id".' };
  }
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    return { ok: false, error: 'Отсутствует строковое поле "title".' };
  }
  if (typeof obj.imageUrl !== 'string' || !obj.imageUrl.trim()) {
    return { ok: false, error: 'Отсутствует строковое поле "imageUrl".' };
  }

  const bpResult = parseAndValidateBlueprint(obj.blueprint);
  if (!bpResult.ok) return bpResult;

  const motion: CameraMotionPreset = VALID_MOTIONS.has(obj.defaultMotion as CameraMotionPreset)
    ? (obj.defaultMotion as CameraMotionPreset)
    : 'orbit';
  const atmosphere: AtmosphereMode = VALID_ATMOS.has(obj.defaultAtmosphere as AtmosphereMode)
    ? (obj.defaultAtmosphere as AtmosphereMode)
    : 'none';

  return {
    ok: true,
    manifest: {
      id: obj.id.trim(),
      ...(typeof obj.order === 'number' && Number.isFinite(obj.order) ? { order: obj.order } : {}),
      title: obj.title.trim(),
      category: typeof obj.category === 'string' && obj.category.trim() ? obj.category.trim() : '2.5D Сцена',
      imageUrl: obj.imageUrl.trim(),
      ...(typeof obj.depthMapUrl === 'string' && obj.depthMapUrl.trim()
        ? { depthMapUrl: obj.depthMapUrl.trim() }
        : {}),
      ...(typeof obj.cleanPlateUrl === 'string' && obj.cleanPlateUrl.trim()
        ? { cleanPlateUrl: obj.cleanPlateUrl.trim() }
        : {}),
      aspectRatio:
        typeof obj.aspectRatio === 'number' && obj.aspectRatio > 0.2 && obj.aspectRatio < 5
          ? obj.aspectRatio
          : 16 / 9,
      defaultMotion: motion,
      defaultAtmosphere: atmosphere,
      defaultConvergence:
        typeof obj.defaultConvergence === 'number'
          ? clamp(obj.defaultConvergence, 0.1, 0.9)
          : 0.54,
      defaultForegroundCut:
        typeof obj.defaultForegroundCut === 'number'
          ? clamp(obj.defaultForegroundCut, 0.35, 0.9)
          : 0.68,
      defaultMidgroundCut:
        typeof obj.defaultMidgroundCut === 'number'
          ? clamp(obj.defaultMidgroundCut, 0.1, 0.65)
          : 0.34,
      cinematographyNote:
        typeof obj.cinematographyNote === 'string' && obj.cinematographyNote.trim()
          ? obj.cinematographyNote.trim()
          : '2.5D-сцена с RGB Guided-фильтром и гибридным параллаксом.',
      blueprint: bpResult.blueprint,
    },
  };
}

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
