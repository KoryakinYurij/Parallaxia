import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomDock } from './components/BottomDock';
import { ExportModal } from './components/ExportModal';
import { ParallaxViewport, type ParallaxViewportHandle } from './components/ParallaxViewport';
import { TechniquesDrawer } from './components/TechniquesDrawer';
import { TopBar } from './components/TopBar';
import { applyDepthBrushStroke, applyDepthContrast } from './engine/depthPipeline';
import {
  computeLdiAndInpaintAssets,
  exportDepthMapDataUrl,
  generateInitialDepth,
  prepareImageAssets,
  resizeImageToBase64,
  type ComputedLdiAssets,
  type LoadedImageAssets,
} from './engine/imageProcessor';
import { STUDIO_SCENES } from './engine/presets';
import type {
  AiSceneAnalysis,
  AtmosphereMode,
  CameraMotionPreset,
  SceneDepthBlueprint,
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

export default function App() {
  const initialScene = STUDIO_SCENES[0];
  const viewportRef = useRef<ParallaxViewportHandle | null>(null);

  const [state, setState] = useState<StudioState>({
    activeTab: 'scene',
    sceneId: initialScene.id,
    pipelineMode: 'ldi',
    motionPreset: initialScene.defaultMotion,
    isPlaying: true,
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
    depthOverlay: 'final',
    brushTool: 'near',
    brushRadius: 0.09,
    brushStrength: 0.7,
    depthContrast: 1.0,
  });

  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [techniquesOpen, setTechniquesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [loadingScene, setLoadingScene] = useState(true);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [customBlueprint, setCustomBlueprint] = useState<SceneDepthBlueprint | null>(null);

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

  // Load image and synthesize initial depth map whenever the active image or blueprint changes
  useEffect(() => {
    let cancelled = false;
    setLoadingScene(true);
    setSceneError(null);

    prepareImageAssets(activeImageUrl)
      .then((assets) => {
        if (cancelled) return;
        const depth = generateInitialDepth(assets, activeBlueprint);
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
  }, [activeImageUrl, activeBlueprint]);

  // Recompute LDI 3-layer separation + disocclusion inpainting when depth or LDI settings change
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
  ]);

  // Keyboard shortcuts: H toggles bottom dock, Space toggles play/pause
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
      depthOverlay: tab === 'depth' && prev.depthOverlay === 'final' ? 'heatmap' : tab === 'depth' ? prev.depthOverlay : 'final',
      pipelineMode: tab === 'layers' && prev.pipelineMode === 'pom' ? 'ldi' : prev.pipelineMode,
    }));
  }, []);

  const handleSelectScene = useCallback((sceneId: string) => {
    const preset = STUDIO_SCENES.find((s) => s.id === sceneId);
    if (!preset) return;
    setCustomImageUrl(null);
    setCustomTitle(null);
    setCustomNote(null);
    setCustomBlueprint(null);
    setAiError(null);
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
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      setCustomImageUrl(reader.result);
      setCustomTitle(file.name.replace(/\.[^.]+$/, '') || 'Пользовательское фото');
      setCustomNote(
        'Карта глубины построена локально по перспективе и контрасту. Нажмите «AI-разбор глубины» или доработайте карту кистью.',
      );
      setCustomBlueprint({
        horizonY: 0.4,
        groundSlope: 0.45,
        edgeWeight: 0.22,
        regions: [],
      });
      setAiError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAnalyzeWithAi = useCallback(async () => {
    if (!imageAssets) return;
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const base64 = resizeImageToBase64(imageAssets.sourceCanvas, 768);
      const response = await fetch('/api/analyze-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      });
      const payload = (await response.json()) as { analysis?: AiSceneAnalysis; error?: string };
      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error || 'Не удалось получить анализ глубины от сервера.');
      }

      const analysis = payload.analysis;
      const validMotions: CameraMotionPreset[] = [
        'orbit',
        'dolly-zoom',
        'truck',
        'ken-burns',
        'breathe',
        'pointer',
      ];
      const validAtmos: AtmosphereMode[] = ['none', 'dust', 'mist', 'rain'];

      const nextBlueprint: SceneDepthBlueprint = {
        horizonY:
          typeof analysis.horizonY === 'number'
            ? Math.min(0.85, Math.max(0.1, analysis.horizonY))
            : 0.4,
        groundSlope: 0.45,
        edgeWeight: 0.16,
        regions: Array.isArray(analysis.regions) ? analysis.regions : [],
      };

      const newDepth = generateInitialDepth(imageAssets, nextBlueprint);
      depthBufferRef.current = newDepth;
      setCustomBlueprint(nextBlueprint);
      if (analysis.title) setCustomTitle(analysis.title);
      if (analysis.cinematographyNote) setCustomNote(analysis.cinematographyNote);

      setState((prev) => ({
        ...prev,
        motionPreset: validMotions.includes(analysis.recommendedMotion as CameraMotionPreset)
          ? (analysis.recommendedMotion as CameraMotionPreset)
          : prev.motionPreset,
        atmosphere: validAtmos.includes(analysis.recommendedAtmosphere as AtmosphereMode)
          ? (analysis.recommendedAtmosphere as AtmosphereMode)
          : prev.atmosphere,
        convergence:
          typeof analysis.recommendedFocus === 'number'
            ? Math.min(0.85, Math.max(0.2, analysis.recommendedFocus))
            : prev.convergence,
      }));
      setDepthRevision((r) => r + 1);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Ошибка запроса к AI-серверу.');
    } finally {
      setAiAnalyzing(false);
    }
  }, [imageAssets]);

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
              Дальний план (Inpaint) · Средний план · Передний план
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
          aiAnalyzing={aiAnalyzing}
          aiError={aiError}
          onToggleCollapse={() => setDockCollapsed((c) => !c)}
          onUpdateState={updateState}
          onSelectScene={handleSelectScene}
          onUploadImage={handleUploadImage}
          onAnalyzeWithAi={handleAnalyzeWithAi}
          onResetDepth={handleResetDepth}
          onRecomputeLdi={handleRecomputeLdi}
        />
      </main>

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
