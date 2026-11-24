export type WorkspaceTab = 'scene' | 'layers' | 'depth' | 'techniques';

export type RenderPipelineMode = 'pom' | 'ldi' | 'exploded';

export type CameraMotionPreset =
  | 'orbit'
  | 'dolly-zoom'
  | 'truck'
  | 'ken-burns'
  | 'breathe'
  | 'pointer';

export type AtmosphereMode = 'none' | 'dust' | 'mist' | 'rain';

export type InpaintAlgorithm = 'multipass' | 'mirror' | 'none';

export type DepthViewOverlay = 'final' | 'grayscale' | 'heatmap' | 'split';

export type DepthBrushTool = 'near' | 'far' | 'smooth';

export interface DepthRegionSpec {
  label: string;
  layer: 'foreground' | 'midground' | 'background';
  shape: 'ellipse' | 'rect' | 'polygon';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Optional normalized polygon vertices [[x,y], ...] when shape === 'polygon' */
  points?: ReadonlyArray<readonly [number, number]>;
  /** Top/primary normalized depth (0 = far, 1 = near) */
  depth: number;
  /** Optional bottom depth for smooth receding perspective surfaces (floors, tables, walls) */
  depthBottom?: number;
  softness: number;
  /** Optional luminance upper bound (0..1) so dark foreground structures don't swallow bright background windows/sky */
  lumaMax?: number;
  /** Optional luminance lower bound (0..1) */
  lumaMin?: number;
  /** Optional excess-green foliage gate (g - (0.56*r + 0.44*b)) */
  greenMin?: number;
  /** Optional minimum HSV saturation (0..1) so vibrant objects separate from neutral gray backgrounds */
  satMin?: number;
  /** Optional universal RGB color key ([r,g,b] in 0..1 or 0..255) for arbitrary hue-based object matting */
  colorTarget?: readonly [number, number, number];
  /** Euclidean RGB tolerance (0..1, default 0.25) used with colorTarget */
  colorTolerance?: number;
  /** When true, matches pixels DIFFERENT from colorTarget (ideal for excluding a known sky/wall color!) */
  invertColorTarget?: boolean;
  /** Enable automatic foreground-vs-surrounding-sky silhouette matting (for outdoor silhouettes against bright sky/mist) */
  autoSkyMatte?: boolean;
}

export interface SceneDepthBlueprint {
  horizonY: number;
  groundSlope: number;
  edgeWeight: number;
  /** Optional horizontal depth tilt (positive = left side closer than right, useful for angled room interiors) */
  horizontalTilt?: number;
  /** Optional Guided Filter radius in processing pixels (default 6) */
  guidedRadius?: number;
  /** Optional Guided Filter regularization eps (default 0.004) */
  guidedEps?: number;
  regions: DepthRegionSpec[];
}

export interface StudioScenePreset {
  id: string;
  order?: number;
  title: string;
  category: string;
  imageUrl: string;
  /** Optional pre-computed grayscale depth map PNG (bright = near, dark = far) */
  depthMapUrl?: string;
  /** Optional generative clean-plate background PNG (foreground removed) overriding algorithmic inpainting */
  cleanPlateUrl?: string;
  aspectRatio: number;
  defaultMotion: CameraMotionPreset;
  defaultAtmosphere: AtmosphereMode;
  defaultConvergence: number;
  defaultForegroundCut: number;
  defaultMidgroundCut: number;
  cinematographyNote: string;
  blueprint: SceneDepthBlueprint;
}

export interface CameraRigState {
  offsetX: number;
  offsetY: number;
  dollyZ: number;
  fov: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface LdiSplitResult {
  width: number;
  height: number;
  backgroundRgba: Uint8ClampedArray;
  midgroundRgba: Uint8ClampedArray;
  foregroundRgba: Uint8ClampedArray;
  disocclusionMask: Uint8Array;
  holePixelCount: number;
  holeCoverageRatio: number;
}

export interface InpaintResult {
  inpaintedRgba: Uint8ClampedArray;
  filledPixels: number;
  iterations: number;
}

export interface StudioState {
  activeTab: WorkspaceTab;
  sceneId: string;
  pipelineMode: RenderPipelineMode;
  motionPreset: CameraMotionPreset;
  isPlaying: boolean;
  speed: number;
  parallaxStrength: number;
  convergence: number;
  dofAmount: number;
  chromaticAmount: number;
  vignetteAmount: number;
  atmosphere: AtmosphereMode;
  foregroundCut: number;
  midgroundCut: number;
  layerSeparation: number;
  edgeFeather: number;
  inpaintMode: InpaintAlgorithm;
  depthOverlay: DepthViewOverlay;
  brushTool: DepthBrushTool;
  brushRadius: number;
  brushStrength: number;
  depthContrast: number;
}

export interface TechniqueGuideItem {
  id: string;
  index: string;
  title: string;
  industryTools: string;
  summary: string;
  howItWorks: string;
  proTip: string;
  applyPatch: Partial<StudioState>;
}
