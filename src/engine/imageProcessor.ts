import {
  applyDepthContrast,
  buildLdiLayers,
  depthBufferToGrayscaleRgba,
  depthBufferToHeatmapRgba,
  disocclusionMaskToRgba,
  inpaintBackgroundPlate,
  synthesizeDepthBuffer,
} from './depthPipeline';
import type { InpaintAlgorithm, SceneDepthBlueprint } from './types';

export interface LoadedImageAssets {
  sourceCanvas: HTMLCanvasElement;
  displayWidth: number;
  displayHeight: number;
  procWidth: number;
  procHeight: number;
  procRgba: Uint8ClampedArray;
  aspectRatio: number;
}

export interface ComputedLdiAssets {
  backgroundCanvas: HTMLCanvasElement;
  midgroundCanvas: HTMLCanvasElement;
  foregroundCanvas: HTMLCanvasElement;
  depthCanvas: HTMLCanvasElement;
  foregroundPreviewUrl: string;
  holeMaskPreviewUrl: string;
  inpaintedPreviewUrl: string;
  holeCoveragePercent: number;
  filledPixels: number;
  iterations: number;
}

const MAX_DISPLAY_WIDTH = 1280;
const PROC_WIDTH = 320;

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Не удалось загрузить изображение: ${url}`));
    img.src = url;
  });
}

export async function prepareImageAssets(imageUrl: string): Promise<LoadedImageAssets> {
  const img = await loadImageElement(imageUrl);
  const naturalW = Math.max(1, img.naturalWidth || img.width);
  const naturalH = Math.max(1, img.naturalHeight || img.height);
  const aspectRatio = naturalW / naturalH;

  const displayWidth = Math.min(MAX_DISPLAY_WIDTH, naturalW);
  const displayHeight = Math.max(1, Math.round(displayWidth / aspectRatio));

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = displayWidth;
  sourceCanvas.height = displayHeight;
  const sCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) throw new Error('2D Canvas context unavailable');
  sCtx.drawImage(img, 0, 0, displayWidth, displayHeight);

  const procWidth = PROC_WIDTH;
  const procHeight = Math.max(64, Math.round(PROC_WIDTH / aspectRatio));
  const procCanvas = document.createElement('canvas');
  procCanvas.width = procWidth;
  procCanvas.height = procHeight;
  const pCtx = procCanvas.getContext('2d', { willReadFrequently: true });
  if (!pCtx) throw new Error('2D Canvas context unavailable');
  pCtx.drawImage(img, 0, 0, procWidth, procHeight);
  const procRgba = pCtx.getImageData(0, 0, procWidth, procHeight).data;

  return {
    sourceCanvas,
    displayWidth,
    displayHeight,
    procWidth,
    procHeight,
    procRgba,
    aspectRatio,
  };
}

export function generateInitialDepth(
  assets: LoadedImageAssets,
  blueprint?: SceneDepthBlueprint | null,
): Float32Array {
  return synthesizeDepthBuffer(assets.procRgba, assets.procWidth, assets.procHeight, blueprint);
}

function rgbaToCanvas(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);
  }
  return canvas;
}

/**
 * Composites a crisp HD display canvas using original full-res RGB pixels
 * masked by a smoothly upscaled alpha matte from the processing resolution.
 */
function buildHighResMaskedLayer(
  sourceCanvas: HTMLCanvasElement,
  lowResRgbaWithAlpha: Uint8ClampedArray,
  procWidth: number,
  procHeight: number,
): HTMLCanvasElement {
  const maskCanvas = rgbaToCanvas(lowResRgbaWithAlpha, procWidth, procHeight);
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Draw upscaled alpha matte first, then source-in full-res RGB image for razor-sharp textures
  ctx.drawImage(maskCanvas, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * Composites a crisp HD background plate: full-res original background pixels
 * outside the disocclusion zone, seamlessly filled with the inpainted buffer inside the hole.
 */
function buildHighResBackgroundPlate(
  sourceCanvas: HTMLCanvasElement,
  inpaintedLowResRgba: Uint8ClampedArray,
  disocclusionMask: Uint8Array,
  procWidth: number,
  procHeight: number,
  algorithm: InpaintAlgorithm,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Build non-hole alpha mask so original HD pixels stay crisp outside the disocclusion zone
  const validMaskRgba = new Uint8ClampedArray(procWidth * procHeight * 4);
  for (let i = 0; i < procWidth * procHeight; i++) {
    const idx = i * 4;
    validMaskRgba[idx] = 255;
    validMaskRgba[idx + 1] = 255;
    validMaskRgba[idx + 2] = 255;
    validMaskRgba[idx + 3] = disocclusionMask[i] === 1 ? 0 : 255;
  }

  if (algorithm !== 'none') {
    // Base layer: smoothly upscaled inpainted plate covering the holes
    const inpaintedCanvas = rgbaToCanvas(inpaintedLowResRgba, procWidth, procHeight);
    ctx.drawImage(inpaintedCanvas, 0, 0, out.width, out.height);
  }

  // Overlay crisp HD original pixels strictly in non-hole regions
  const hdValid = buildHighResMaskedLayer(sourceCanvas, validMaskRgba, procWidth, procHeight);
  ctx.drawImage(hdValid, 0, 0, out.width, out.height);
  return out;
}

export function computeLdiAndInpaintAssets(params: {
  assets: LoadedImageAssets;
  rawDepth: Float32Array;
  depthContrast: number;
  foregroundCut: number;
  midgroundCut: number;
  edgeFeather: number;
  inpaintMode: InpaintAlgorithm;
}): ComputedLdiAssets {
  const {
    assets,
    rawDepth,
    depthContrast,
    foregroundCut,
    midgroundCut,
    edgeFeather,
    inpaintMode,
  } = params;

  const adjustedDepth = applyDepthContrast(rawDepth, depthContrast);

  const ldi = buildLdiLayers({
    rgba: assets.procRgba,
    depth: adjustedDepth,
    width: assets.procWidth,
    height: assets.procHeight,
    foregroundCut,
    midgroundCut,
    feather: edgeFeather,
    dilationPx: 3,
  });

  const inpaint = inpaintBackgroundPlate({
    backgroundRgba: ldi.backgroundRgba,
    disocclusionMask: ldi.disocclusionMask,
    width: assets.procWidth,
    height: assets.procHeight,
    algorithm: inpaintMode,
    maxIterations: 96,
  });

  const foregroundCanvas = buildHighResMaskedLayer(
    assets.sourceCanvas,
    ldi.foregroundRgba,
    assets.procWidth,
    assets.procHeight,
  );
  const midgroundCanvas = buildHighResMaskedLayer(
    assets.sourceCanvas,
    ldi.midgroundRgba,
    assets.procWidth,
    assets.procHeight,
  );
  const backgroundCanvas = buildHighResBackgroundPlate(
    assets.sourceCanvas,
    inpaint.inpaintedRgba,
    ldi.disocclusionMask,
    assets.procWidth,
    assets.procHeight,
    inpaintMode,
  );

  const depthGray = depthBufferToGrayscaleRgba(adjustedDepth);
  const depthCanvas = rgbaToCanvas(depthGray, assets.procWidth, assets.procHeight);

  // Compact preview thumbnails for the LDI & Inpainting Inspector
  const fgThumbCanvas = rgbaToCanvas(ldi.foregroundRgba, assets.procWidth, assets.procHeight);
  const holeThumbCanvas = rgbaToCanvas(
    disocclusionMaskToRgba(ldi.disocclusionMask),
    assets.procWidth,
    assets.procHeight,
  );
  const inpaintThumbCanvas = rgbaToCanvas(inpaint.inpaintedRgba, assets.procWidth, assets.procHeight);

  return {
    backgroundCanvas,
    midgroundCanvas,
    foregroundCanvas,
    depthCanvas,
    foregroundPreviewUrl: fgThumbCanvas.toDataURL('image/png'),
    holeMaskPreviewUrl: holeThumbCanvas.toDataURL('image/png'),
    inpaintedPreviewUrl: inpaintThumbCanvas.toDataURL('image/png'),
    holeCoveragePercent: Math.round(ldi.holeCoverageRatio * 1000) / 10,
    filledPixels: inpaint.filledPixels,
    iterations: inpaint.iterations,
  };
}

export function exportDepthMapDataUrl(
  depth: Float32Array,
  width: number,
  height: number,
  heatmap: boolean,
): string {
  const rgba = heatmap ? depthBufferToHeatmapRgba(depth) : depthBufferToGrayscaleRgba(depth);
  return rgbaToCanvas(rgba, width, height).toDataURL('image/png');
}

export function resizeImageToBase64(sourceCanvas: HTMLCanvasElement, maxW = 768): string {
  const scale = Math.min(1, maxW / sourceCanvas.width);
  const w = Math.max(1, Math.round(sourceCanvas.width * scale));
  const h = Math.max(1, Math.round(sourceCanvas.height * scale));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  return tmp.toDataURL('image/jpeg', 0.82);
}
