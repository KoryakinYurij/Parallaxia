import {
  applyDepthContrast,
  buildLdiLayers,
  depthBufferToGrayscaleRgba,
  depthBufferToHeatmapRgba,
  disocclusionMaskToRgba,
  guidedFilterDepth,
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
  usingCleanPlate: boolean;
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

/**
 * Loads an external grayscale depth map PNG/JPG (bright = near, dark = far),
 * normalizes to [0..1] at processing resolution, and optionally refines edges
 * with the 3-channel RGB Guided Image Filter against the original photograph.
 */
export async function loadExternalDepthBuffer(params: {
  depthMapUrl: string;
  assets: LoadedImageAssets;
  applyGuidedSnap?: boolean;
  invert?: boolean;
}): Promise<Float32Array> {
  const { depthMapUrl, assets, applyGuidedSnap = true, invert = false } = params;
  const img = await loadImageElement(depthMapUrl);
  const canvas = document.createElement('canvas');
  canvas.width = assets.procWidth;
  canvas.height = assets.procHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D Canvas context unavailable');
  ctx.drawImage(img, 0, 0, assets.procWidth, assets.procHeight);
  const data = ctx.getImageData(0, 0, assets.procWidth, assets.procHeight).data;

  const total = assets.procWidth * assets.procHeight;
  const raw = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const lum = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
    raw[i] = invert ? 1 - lum : lum;
  }

  return applyGuidedSnap
    ? guidedFilterDepth(raw, assets.procRgba, assets.procWidth, assets.procHeight, 5, 0.003)
    : raw;
}

/**
 * Loads an external HD generative clean-plate background (foreground removed)
 * matching the display canvas dimensions.
 */
export async function loadCleanPlateCanvas(
  cleanPlateUrl: string,
  displayWidth: number,
  displayHeight: number,
): Promise<HTMLCanvasElement> {
  const img = await loadImageElement(cleanPlateUrl);
  const canvas = document.createElement('canvas');
  canvas.width = displayWidth;
  canvas.height = displayHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D Canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
  return canvas;
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
  ctx.drawImage(maskCanvas, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * Composites a crisp HD background plate: full-res original background pixels
 * outside the disocclusion zone, seamlessly filled inside the hole with either
 * a supplied HD generative Clean Plate or the multi-scale inpainted buffer.
 */
function buildHighResBackgroundPlate(
  sourceCanvas: HTMLCanvasElement,
  inpaintedLowResRgba: Uint8ClampedArray,
  disocclusionMask: Uint8Array,
  procWidth: number,
  procHeight: number,
  algorithm: InpaintAlgorithm,
  cleanPlateCanvas?: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const validMaskRgba = new Uint8ClampedArray(procWidth * procHeight * 4);
  for (let i = 0; i < procWidth * procHeight; i++) {
    const idx = i * 4;
    validMaskRgba[idx] = 255;
    validMaskRgba[idx + 1] = 255;
    validMaskRgba[idx + 2] = 255;
    validMaskRgba[idx + 3] = disocclusionMask[i] === 1 ? 0 : 255;
  }

  if (algorithm !== 'none') {
    if (cleanPlateCanvas) {
      // Studio-grade generative Clean Plate fills disocclusion holes with crisp HD detail!
      ctx.drawImage(cleanPlateCanvas, 0, 0, out.width, out.height);
    } else {
      const inpaintedCanvas = rgbaToCanvas(inpaintedLowResRgba, procWidth, procHeight);
      ctx.drawImage(inpaintedCanvas, 0, 0, out.width, out.height);
    }
  }

  const hdValid = buildHighResMaskedLayer(sourceCanvas, validMaskRgba, procWidth, procHeight);
  ctx.drawImage(hdValid, 0, 0, out.width, out.height);
  return out;
}

function makeThumbnailDataUrl(canvas: HTMLCanvasElement, maxW = 320): string {
  const scale = Math.min(1, maxW / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(canvas, 0, 0, w, h);
  return tmp.toDataURL('image/png');
}

export function computeLdiAndInpaintAssets(params: {
  assets: LoadedImageAssets;
  rawDepth: Float32Array;
  depthContrast: number;
  foregroundCut: number;
  midgroundCut: number;
  edgeFeather: number;
  inpaintMode: InpaintAlgorithm;
  cleanPlateCanvas?: HTMLCanvasElement | null;
}): ComputedLdiAssets {
  const {
    assets,
    rawDepth,
    depthContrast,
    foregroundCut,
    midgroundCut,
    edgeFeather,
    inpaintMode,
    cleanPlateCanvas,
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

  const usingCleanPlate = Boolean(cleanPlateCanvas) && inpaintMode !== 'none';

  const inpaint = usingCleanPlate
    ? {
        inpaintedRgba: ldi.backgroundRgba,
        filledPixels: ldi.holePixelCount,
        iterations: 1,
      }
    : inpaintBackgroundPlate({
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
    cleanPlateCanvas,
  );

  const depthGray = depthBufferToGrayscaleRgba(adjustedDepth);
  const depthCanvas = rgbaToCanvas(depthGray, assets.procWidth, assets.procHeight);

  const fgThumbCanvas = rgbaToCanvas(ldi.foregroundRgba, assets.procWidth, assets.procHeight);
  const holeThumbCanvas = rgbaToCanvas(
    disocclusionMaskToRgba(ldi.disocclusionMask),
    assets.procWidth,
    assets.procHeight,
  );
  const inpaintedPreviewUrl = usingCleanPlate
    ? makeThumbnailDataUrl(backgroundCanvas, assets.procWidth)
    : rgbaToCanvas(inpaint.inpaintedRgba, assets.procWidth, assets.procHeight).toDataURL('image/png');

  return {
    backgroundCanvas,
    midgroundCanvas,
    foregroundCanvas,
    depthCanvas,
    foregroundPreviewUrl: fgThumbCanvas.toDataURL('image/png'),
    holeMaskPreviewUrl: holeThumbCanvas.toDataURL('image/png'),
    inpaintedPreviewUrl,
    holeCoveragePercent: Math.round(ldi.holeCoverageRatio * 1000) / 10,
    filledPixels: inpaint.filledPixels,
    iterations: inpaint.iterations,
    usingCleanPlate,
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
