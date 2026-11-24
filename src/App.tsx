import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { ExportModal } from './components/ExportModal';
import { ParallaxViewport, type ParallaxViewportHandle } from './components/ParallaxViewport';
import { RecipeModal } from './components/RecipeModal';
import { TechniquesDrawer } from './components/TechniquesDrawer';
import { TopBar } from './components/TopBar';
import {
  applyDepthBrushStroke,
  applyDepthContrast,
  parseAndValidateBlueprint,
  parseAndValidateSceneManifest,
} from './engine/depthPipeline';
import {
  computeLdiAndInpaintAssets,
  exportDepthMapDataUrl,
  generateInitialDepth,
  loadCleanPlateCanvas,
  loadExternalDepthBuffer,
  prepareImageAssets,
  type ComputedLdiAssets,
  type LoadedImageAssets,
} from './engine/imageProcessor';
import { STUDIO_SCENES } from './engine/presets';
import type {
  DepthViewOverlay,
  RenderPipelineMode,
  SceneDepthBlueprint,
  StudioScenePreset,
  StudioState,
  WorkspaceTab,
} from './engine/types';

function triggerDownloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Не удалось прочитать файл'));
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

function parseInitialUrlOverrides(scenes: StudioScenePreset[]) {
  if (typeof window === 'undefined') {
    return {
      scene: scenes[0],
      tab: 'scene' as WorkspaceTab,
      overlay: 'final' as DepthViewOverlay,
      pipeline: 'pom' as RenderPipelineMode,
      dockCollapsed: false,
      paused: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const sceneParam = params.get('scene');
  const scene = scenes.find((s) => s.id === sceneParam) ?? scenes[0];

  const tabParam = params.get('tab');
  const tab: WorkspaceTab =
    tabParam === 'layers' || tabParam === 'depth' || tabParam === 'scene' ? tabParam : 'scene';

  const overlayParam = params.get('overlay');
  const overlay: DepthViewOverlay =
    overlayParam === 'heatmap' ||
    overlayParam === 'grayscale' ||
    overlayParam === 'split' ||
    overlayParam === 'final'
      ? overlayParam
      : tab === 'depth'
        ? 'heatmap'
        : 'final';

  const pipeParam = params.get('pipeline');
  const pipeline: RenderPipelineMode =
    pipeParam === 'ldi' || pipeParam === 'exploded' || pipeParam === 'pom' ? pipeParam : 'pom';

  const dockCollapsed = params.get('dock') === '0';
  const paused = params.get('paused') === '1';

  return { scene, tab, overlay, pipeline, dockCollapsed, paused };
}

export default function App() {
  const boot = useMemo(() => parseInitialUrlOverrides(STUDIO_SCENES), []);
  const initialScene = boot.scene;
  const viewportRef = useRef<ParallaxViewportHandle | null>(null);

  const [state, setState] = useState<StudioState>({
    activeTab: boot.tab,
    sceneId: initialScene.id,
    pipelineMode: boot.pipeline,
    motionPreset: initialScene.defaultMotion,
    isPlaying: !boot.paused,
    speed: 1.0,
    parallaxStrength: 0.65,
    convergence: initialScene.defaultConvergence,
    dofAmount: 0.25,
    chromaticAmount: 0.16,
    vignetteAmount: 0.34,
    atmosphere: initialScene.defaultAtmosphere,
    foregroundCut: initialScene.defaultForegroundCut,
    midgroundCut: initialScene.defaultMidgroundCut,
    layerSeparation: 0.6,
    edgeFeather: 0.06,
    inpaintMode: 'multipass',
    depthOverlay: boot.overlay,
    brushTool: 'near',
    brushRadius: 0.09,
    brushStrength: 0.7,
    depthContrast: 1.0,
  });

  const [dockCollapsed, setDockCollapsed] = useState(boot.dockCollapsed);
  const [techniquesOpen, setTechniquesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [loadingScene, setLoadingScene] = useState(true);
  const [sceneError, setSceneError] = useState<string | null>(null);

  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [customBlueprint, setCustomBlueprint] = useState<SceneDepthBlueprint | null>(null);

  // External studio passes (can come from Scene Manifest JSON or direct user upload)
  const [customDepthMapUrl, setCustomDepthMapUrl] = useState<string | null>(null);
  const [invertExternalDepth, setInvertExternalDepth] = useState(false);
  const [snapExternalDepth, setSnapExternalDepth] = useState(true);

  const [customCleanPlateUrl, setCustomCleanPlateUrl] = useState<string | null>(null);
  const [cleanPlateCanvas, setCleanPlateCanvas] = useState<HTMLCanvasElement | null>(null);

  const [imageAssets, setImageAssets] = useState<LoadedImageAssets | null>(null);
  const [ldiAssets, setLdiAssets] = useState<ComputedLdiAssets | null>(null);

  // Mutable depth buffer stored in ref for smooth 60Hz interactive brushing + revision counter for LDI rebuild
  const depthBufferRef = useRef<Float32Array | null>(null);
  const [depthRevision, setDepthRevision] = useState(0);

  const activePreset = useMemo(
    () => STUDIO_SCENES.find((s) => s.id === state.sceneId) ?? STUDIO_SCENES[0],
    [state.sceneId],
  );

  const activeImageUrl = customImageUrl ?? activePreset.imageUrl;
  const activeSceneTitle = customTitle ?? activePreset.title;
  const activeNote = customNote ?? activePreset.cinematographyNote;
  const activeBlueprint = customBlueprint ?? activePreset.blueprint;
  const effectiveDepthMapUrl = customDepthMapUrl ?? activePreset.depthMapUrl ?? null;
  const effectiveCleanPlateUrl = customCleanPlateUrl ?? activePreset.cleanPlateUrl ?? null;

  // Build current live manifest snapshot for the Recipe JSON modal
  const liveManifest = useMemo<StudioScenePreset>(
    () => ({
      id: activePreset.id,
      ...(activePreset.order !== undefined ? { order: activePreset.order } : {}),
      title: activeSceneTitle,
      category: activePreset.category,
      imageUrl: customImageUrl ? '(uploaded-data-url)' : activePreset.imageUrl,
      ...(activePreset.depthMapUrl ? { depthMapUrl: activePreset.depthMapUrl } : {}),
      ...(activePreset.cleanPlateUrl ? { cleanPlateUrl: activePreset.cleanPlateUrl } : {}),
      aspectRatio: imageAssets?.aspectRatio ?? activePreset.aspectRatio,
      defaultMotion: state.motionPreset,
      defaultAtmosphere: state.atmosphere,
      defaultConvergence: state.convergence,
      defaultForegroundCut: state.foregroundCut,
      defaultMidgroundCut: state.midgroundCut,
      cinematographyNote: activeNote,
      blueprint: activeBlueprint,
    }),
    [
      activePreset,
      activeSceneTitle,
      customImageUrl,
      imageAssets,
      state.motionPreset,
      state.atmosphere,
      state.convergence,
      state.foregroundCut,
      state.midgroundCut,
      activeNote,
      activeBlueprint,
    ],
  );

  // Load source image + depth buffer (external Depth PNG if present, otherwise blueprint synthesis + RGB Guided Filter)
  useEffect(() => {
    let cancelled = false;
    setLoadingScene(true);
    setSceneError(null);

    prepareImageAssets(activeImageUrl)
      .then(async (assets) => {
        if (cancelled) return;
        let depth: Float32Array;
        if (effectiveDepthMapUrl) {
          depth = await loadExternalDepthBuffer({
            depthMapUrl: effectiveDepthMapUrl,
            assets,
            applyGuidedSnap: snapExternalDepth,
            invert: invertExternalDepth,
          });
        } else {
          depth = generateInitialDepth(assets, activeBlueprint);
        }
        if (cancelled) return;
        depthBufferRef.current = depth;
        setImageAssets(assets);
        setDepthRevision((r) => r + 1);
        setLoadingScene(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setSceneError(err instanceof Error ? err.message : 'Ошибка загрузки изображения');
        setLoadingScene(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeImageUrl,
    activeBlueprint,
    effectiveDepthMapUrl,
    snapExternalDepth,
    invertExternalDepth,
  ]);

  // Load optional HD Clean Plate background whenever active cleanPlateUrl or display size changes
  useEffect(() => {
    if (!imageAssets || !effectiveCleanPlateUrl) {
      setCleanPlateCanvas(null);
      return;
    }
    let cancelled = false;
    loadCleanPlateCanvas(
      effectiveCleanPlateUrl,
      imageAssets.displayWidth,
      imageAssets.displayHeight,
    )
      .then((canvas) => {
        if (!cancelled) setCleanPlateCanvas(canvas);
      })
      .catch((err) => {
        if (!cancelled) {
          setCleanPlateCanvas(null);
          setSceneError(
            err instanceof Error ? err.message : 'Не удалось загрузить чистый фон (Clean Plate)',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageAssets, effectiveCleanPlateUrl]);

  // Recompute LDI 3-layer separation + disocclusion inpainting (or Clean Plate composite)
  useEffect(() => {
    if (!imageAssets || !depthBufferRef.current) return;
    const computed = computeLdiAndInpaintAssets({
      assets: imageAssets,
      rawDepth: depthBufferRef.current,
      depthContrast: state.depthContrast,
      foregroundCut: state.foregroundCut,
      midgroundCut: state.midgroundCut,
      edgeFeather: state.edgeFeather,
      inpaintMode: state.inpaintMode,
      cleanPlateCanvas,
    });
    setLdiAssets(computed);
  }, [
    imageAssets,
    depthRevision,
    state.depthContrast,
    state.foregroundCut,
    state.midgroundCut,
    state.edgeFeather,
    state.inpaintMode,
    cleanPlateCanvas,
  ]);

  // Keyboard shortcuts: H toggles bottom dock, Space toggles play/pause, Escape closes modals
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        setDockCollapsed((c) => !c);
      } else if (e.key === ' ') {
        e.preventDefault();
        setState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
      } else if (e.key === 'Escape') {
        setTechniquesOpen(false);
        setExportOpen(false);
        setRecipeOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updateState = useCallback((patch: Partial<StudioState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectTab = useCallback((tab: WorkspaceTab) => {
    if (tab === 'techniques') {
      setTechniquesOpen(true);
      return;
    }
    setTechniquesOpen(false);
    setDockCollapsed(false);
    setState((prev) => ({
      ...prev,
      activeTab: tab,
      depthOverlay:
        tab === 'depth' && prev.depthOverlay === 'final'
          ? 'heatmap'
          : tab === 'depth'
            ? prev.depthOverlay
            : 'final',
    }));
  }, []);

  const handleSelectScene = useCallback((sceneId: string) => {
    const preset = STUDIO_SCENES.find((s) => s.id === sceneId);
    if (!preset) return;
    setCustomImageUrl(null);
    setCustomTitle(null);
    setCustomNote(null);
    setCustomBlueprint(null);
    setCustomDepthMapUrl(null);
    setCustomCleanPlateUrl(null);
    setInvertExternalDepth(false);
    setSnapExternalDepth(true);
    setState((prev) => ({
      ...prev,
      sceneId: preset.id,
      motionPreset: preset.defaultMotion,
      atmosphere: preset.defaultAtmosphere,
      convergence: preset.defaultConvergence,
      foregroundCut: preset.defaultForegroundCut,
      midgroundCut: preset.defaultMidgroundCut,
      depthContrast: 1.0,
    }));
  }, []);

  const handleUploadImage = useCallback((file: File) => {
    readFileAsDataUrl(file)
      .then((dataUrl) => {
        setCustomImageUrl(dataUrl);
        setCustomTitle(file.name.replace(/\.[^.]+$/, '') || 'Пользовательское фото');
        setCustomNote(
          'Локальная перспектива + RGB Guided Filter. Загрузите внешнюю карту глубины PNG, чистый фон Clean Plate или настройте рецепт JSON.',
        );
        setCustomBlueprint({
          horizonY: 0.42,
          groundSlope: 0.42,
          edgeWeight: 0.1,
          regions: [],
        });
        setCustomDepthMapUrl(null);
        setCustomCleanPlateUrl(null);
      })
      .catch((err) => {
        setSceneError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
      });
  }, []);

  const handleUploadDepthMap = useCallback((file: File) => {
    readFileAsDataUrl(file)
      .then((dataUrl) => {
        setCustomDepthMapUrl(dataUrl);
      })
      .catch((err) => {
        setSceneError(err instanceof Error ? err.message : 'Ошибка чтения карты глубины');
      });
  }, []);

  const handleUploadCleanPlate = useCallback((file: File) => {
    readFileAsDataUrl(file)
      .then((dataUrl) => {
        setCustomCleanPlateUrl(dataUrl);
      })
      .catch((err) => {
        setSceneError(err instanceof Error ? err.message : 'Ошибка чтения чистого фона');
      });
  }, []);

  const handleApplyRecipeJson = useCallback(
    (rawJson: string): { ok: true } | { ok: false; error: string } => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch (err) {
        return {
          ok: false,
          error: `Синтаксическая ошибка JSON: ${err instanceof Error ? err.message : 'некорректный JSON'}`,
        };
      }

      // Accept either a full Scene Manifest or a standalone SceneDepthBlueprint
      if (parsed && typeof parsed === 'object' && 'blueprint' in parsed) {
        const res = parseAndValidateSceneManifest(parsed);
        if (!res.ok) return res;
        const m = res.manifest;
        setCustomBlueprint(m.blueprint);
        setCustomTitle(m.title);
        setCustomNote(m.cinematographyNote);
        setCustomDepthMapUrl(m.depthMapUrl ?? null);
        if (m.cleanPlateUrl) setCustomCleanPlateUrl(m.cleanPlateUrl);
        setState((prev) => ({
          ...prev,
          motionPreset: m.defaultMotion,
          atmosphere: m.defaultAtmosphere,
          convergence: m.defaultConvergence,
          foregroundCut: m.defaultForegroundCut,
          midgroundCut: m.defaultMidgroundCut,
        }));
        return { ok: true };
      }

      const bpRes = parseAndValidateBlueprint(parsed);
      if (!bpRes.ok) return bpRes;
      setCustomDepthMapUrl(null);
      setCustomBlueprint(bpRes.blueprint);
      return { ok: true };
    },
    [],
  );

  const brushThrottleRef = useRef(0);
  const handleBrushPaint = useCallback(
    (nx: number, ny: number, commit: boolean) => {
      if (!imageAssets || !depthBufferRef.current) return;
      applyDepthBrushStroke({
        depth: depthBufferRef.current,
        width: imageAssets.procWidth,
        height: imageAssets.procHeight,
        nx,
        ny,
        radiusNorm: state.brushRadius,
        strength: state.brushStrength,
        tool: state.brushTool,
      });

      const now = performance.now();
      if (commit || now - brushThrottleRef.current > 90) {
        brushThrottleRef.current = now;
        setDepthRevision((r) => r + 1);
      }
    },
    [imageAssets, state.brushRadius, state.brushStrength, state.brushTool],
  );

  const handleResetDepth = useCallback(() => {
    if (!imageAssets) return;
    setCustomDepthMapUrl(null);
    depthBufferRef.current = generateInitialDepth(imageAssets, activeBlueprint);
    setState((prev) => ({ ...prev, depthContrast: 1.0 }));
    setDepthRevision((r) => r + 1);
  }, [imageAssets, activeBlueprint]);

  const handleRecomputeLdi = useCallback(() => {
    setDepthRevision((r) => r + 1);
  }, []);

  const handleApplyTechnique = useCallback((patch: Partial<StudioState>) => {
    setDockCollapsed(false);
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleDownloadFramePng = useCallback(() => {
    const url = viewportRef.current?.captureFrameDataUrl();
    if (url) triggerDownloadDataUrl(url, 'parallaxia-frame.png');
  }, []);

  const handleDownloadDepthPng = useCallback(() => {
    if (!imageAssets || !depthBufferRef.current) return;
    const adjusted = applyDepthContrast(depthBufferRef.current, state.depthContrast);
    const url = exportDepthMapDataUrl(
      adjusted,
      imageAssets.procWidth,
      imageAssets.procHeight,
      false,
    );
    triggerDownloadDataUrl(url, 'parallaxia-depth-map.png');
  }, [imageAssets, state.depthContrast]);

  const handleDownloadInpaintedBgPng = useCallback(() => {
    if (!ldiAssets) return;
    const url = ldiAssets.backgroundCanvas.toDataURL('image/png');
    triggerDownloadDataUrl(url, 'parallaxia-inpainted-background.png');
  }, [ldiAssets]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0B0D10] text-[#ECEFF4]">
      <TopBar
        activeTab={techniquesOpen ? 'techniques' : state.activeTab}
        onSelectTab={handleSelectTab}
        onOpenExport={() => setExportOpen(true)}
      />

      <main className="relative flex-1 overflow-hidden">
        <ParallaxViewport
          ref={viewportRef}
          state={state}
          dockCollapsed={dockCollapsed}
          imageAssets={imageAssets}
          ldiAssets={ldiAssets}
          fallbackImageUrl={activeImageUrl}
          onBrushPaint={handleBrushPaint}
        />

        {/* Subtle loading veil during scene asset switch */}
        {loadingScene && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#0B0D10]/70">
            <p className="font-mono text-xs text-[#C7CDD8]">
              Синтез карты глубины и LDI-слоёв...
            </p>
          </div>
        )}

        {sceneError && (
          <div
            role="alert"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-red-500/30 bg-[#1B1214] px-4 py-2 text-xs text-red-200"
          >
            {sceneError}
          </div>
        )}

        {/* Exploded 3D Layer Legend (only shown when inspecting 3D Z-planes) */}
        {state.pipelineMode === 'exploded' && state.activeTab !== 'depth' && (
          <div className="pointer-events-none absolute top-4 left-4 z-10 rounded-lg border border-white/[0.08] bg-[#12161E]/95 px-3.5 py-2.5 text-xs">
            <p className="font-medium text-[#F5F7FA]">3D Разбор слоёв (LDI Stack)</p>
            <p className="mt-1 text-[#9AA4B4]">
              Дальний план ({ldiAssets?.usingCleanPlate ? 'Clean Plate' : 'Inpaint'}) · Средний план · Передний план
            </p>
          </div>
        )}

        <BottomDock
          state={state}
          scenes={STUDIO_SCENES}
          activeSceneTitle={activeSceneTitle}
          cinematographyNote={activeNote}
          ldiAssets={ldiAssets}
          collapsed={dockCollapsed}
          hasExternalDepth={Boolean(effectiveDepthMapUrl)}
          hasCleanPlate={Boolean(effectiveCleanPlateUrl)}
          onToggleCollapse={() => setDockCollapsed((c) => !c)}
          onUpdateState={updateState}
          onSelectScene={handleSelectScene}
          onUploadImage={handleUploadImage}
          onUploadDepthMap={handleUploadDepthMap}
          onUploadCleanPlate={handleUploadCleanPlate}
          onClearCleanPlate={() => setCustomCleanPlateUrl(null)}
          onOpenRecipe={() => setRecipeOpen(true)}
          onResetDepth={handleResetDepth}
          onRecomputeLdi={handleRecomputeLdi}
        />
      </main>

      <RecipeModal
        open={recipeOpen}
        currentManifest={liveManifest}
        hasExternalDepth={Boolean(effectiveDepthMapUrl)}
        hasCleanPlate={Boolean(effectiveCleanPlateUrl)}
        invertExternalDepth={invertExternalDepth}
        snapExternalDepth={snapExternalDepth}
        onClose={() => setRecipeOpen(false)}
        onApplyJson={handleApplyRecipeJson}
        onUploadDepthMap={handleUploadDepthMap}
        onClearDepthMap={() => setCustomDepthMapUrl(null)}
        onToggleInvertDepth={setInvertExternalDepth}
        onToggleSnapDepth={setSnapExternalDepth}
        onUploadCleanPlate={handleUploadCleanPlate}
        onClearCleanPlate={() => setCustomCleanPlateUrl(null)}
      />

      <TechniquesDrawer
        open={techniquesOpen}
        onClose={() => setTechniquesOpen(false)}
        onApplyTechnique={handleApplyTechnique}
      />

      <ExportModal
        open={exportOpen}
        sceneTitle={activeSceneTitle}
        onClose={() => setExportOpen(false)}
        onRecordWebm={(durationSec, onProgress) => {
          if (!viewportRef.current) {
            return Promise.reject(new Error('Viewport не готов'));
          }
          return viewportRef.current.recordLoopWebm(durationSec, onProgress);
        }}
        onDownloadFramePng={handleDownloadFramePng}
        onDownloadDepthPng={handleDownloadDepthPng}
        onDownloadInpaintedBgPng={handleDownloadInpaintedBgPng}
      />
    </div>
  );
}
