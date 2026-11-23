export type WorkspaceTab = 'scene' | 'layers' | 'depth' | 'techniques';

export type RenderPipelineMode = 'ldi' | 'pom' | 'exploded';

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
  shape: 'ellipse' | 'rect';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  depth: number;
  softness: number;
}

export interface SceneDepthBlueprint {
  horizonY: number;
  groundSlope: number;
  edgeWeight: number;
  regions: DepthRegionSpec[];
}

export interface StudioScenePreset {
  id: string;
  title: string;
  category: string;
  imageUrl: string;
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

export interface AiSceneAnalysis {
  title?: string;
  horizonY?: number;
  recommendedMotion?: string;
  recommendedAtmosphere?: string;
  recommendedFocus?: number;
  cinematographyNote?: string;
  regions?: DepthRegionSpec[];
}
