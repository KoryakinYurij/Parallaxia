import React, { useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Code2,
  ImagePlus,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Upload,
} from 'lucide-react';
import type { ComputedLdiAssets } from '../engine/imageProcessor';
import type {
  AtmosphereMode,
  CameraMotionPreset,
  DepthBrushTool,
  DepthViewOverlay,
  InpaintAlgorithm,
  RenderPipelineMode,
  StudioScenePreset,
  StudioState,
} from '../engine/types';

interface BottomDockProps {
  state: StudioState;
  scenes: StudioScenePreset[];
  activeSceneTitle: string;
  cinematographyNote: string;
  ldiAssets: ComputedLdiAssets | null;
  collapsed: boolean;
  hasExternalDepth: boolean;
  hasCleanPlate: boolean;
  onToggleCollapse: () => void;
  onUpdateState: (patch: Partial<StudioState>) => void;
  onSelectScene: (sceneId: string) => void;
  onUploadImage: (file: File) => void;
  onUploadDepthMap: (file: File) => void;
  onUploadCleanPlate: (file: File) => void;
  onClearCleanPlate: () => void;
  onOpenRecipe: () => void;
  onResetDepth: () => void;
  onRecomputeLdi: () => void;
}

const MOTION_OPTIONS: ReadonlyArray<{ id: CameraMotionPreset; label: string }> = [
  { id: 'orbit', label: 'Орбита' },
  { id: 'dolly-zoom', label: 'Долли-зум' },
  { id: 'truck', label: 'Проезд' },
  { id: 'ken-burns', label: 'Кен Бёрнс' },
  { id: 'breathe', label: 'Дыхание' },
  { id: 'pointer', label: 'Курсор' },
];

const ATMOSPHERE_OPTIONS: ReadonlyArray<{ id: AtmosphereMode; label: string }> = [
  { id: 'none', label: 'Нет' },
  { id: 'dust', label: 'Пыль' },
  { id: 'mist', label: 'Туман' },
  { id: 'rain', label: 'Дождь' },
];

const PIPELINE_OPTIONS: ReadonlyArray<{ id: RenderPipelineMode; label: string }> = [
  { id: 'pom', label: 'Гибрид 2.5D (POM + Inpaint)' },
  { id: 'ldi', label: 'LDI Слои (3D)' },
  { id: 'exploded', label: '3D Разбор слоёв' },
];

const INPAINT_OPTIONS: ReadonlyArray<{ id: InpaintAlgorithm; label: string }> = [
  { id: 'multipass', label: 'Многопроходный Inpaint' },
  { id: 'mirror', label: 'Зеркальный край' },
  { id: 'none', label: 'Выкл. (показать разрывы)' },
];

const OVERLAY_OPTIONS: ReadonlyArray<{ id: DepthViewOverlay; label: string }> = [
  { id: 'final', label: 'Итог 2.5D' },
  { id: 'grayscale', label: 'Ч/Б глубина' },
  { id: 'heatmap', label: 'Теплокарта' },
  { id: 'split', label: 'До / После' },
];

const BRUSH_OPTIONS: ReadonlyArray<{ id: DepthBrushTool; label: string }> = [
  { id: 'near', label: 'Ближе (Белый)' },
  { id: 'far', label: 'Дальше (Чёрный)' },
  { id: 'smooth', label: 'Сгладить' },
];

interface SliderControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (val: number) => void;
}

function SliderControl({
  id,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: SliderControlProps) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[120px]">
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={id} className="text-[#9AA4B4] whitespace-nowrap">
          {label}
        </label>
        <span className="font-mono tabular-nums text-[#E4E8F0]">{displayValue}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="studio-slider w-full"
      />
    </div>
  );
}

export function BottomDock({
  state,
  scenes,
  activeSceneTitle,
  cinematographyNote,
  ldiAssets,
  collapsed,
  hasExternalDepth,
  hasCleanPlate,
  onToggleCollapse,
  onUpdateState,
  onSelectScene,
  onUploadImage,
  onUploadDepthMap,
  onUploadCleanPlate,
  onClearCleanPlate,
  onOpenRecipe,
  onResetDepth,
  onRecomputeLdi,
}: BottomDockProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const depthInputRef = useRef<HTMLInputElement | null>(null);
  const cleanPlateInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadImage(file);
      e.target.value = '';
    }
  };

  const dockTab = state.activeTab === 'techniques' ? 'scene' : state.activeTab;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center px-3 sm:px-5 pb-3 transition-transform duration-200 ease-out ${
        collapsed ? 'translate-y-[calc(100%-36px)]' : 'translate-y-0'
      }`}
    >
      {/* Attached Collapse / Expand Tab */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        className="pointer-events-auto flex items-center gap-1.5 rounded-t-md border border-b-0 border-white/[0.1] bg-[#131720] px-3.5 py-1.5 text-xs font-medium text-[#B8C0CE] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
      >
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <span>{collapsed ? 'Открыть панель (H)' : 'Скрыть панель (H)'}</span>
      </button>

      {/* Main Dock Surface (Solid opaque dark studio surface — zero backdrop-filter over WebGL) */}
      <section
        aria-label="Панель управления 2.5D сценой"
        className="pointer-events-auto w-full max-w-[1160px] rounded-xl border border-white/[0.1] bg-[#131720] px-4 py-3 shadow-2xl"
      >
        {/* SCENE & CAMERA TAB */}
        {dockTab === 'scene' && (
          <div className="flex flex-col gap-2.5">
            {/* Row 1: Auto-Discovered Scene Selector + Upload + JSON Recipe (Single Row on Desktop) */}
            <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 border-b border-white/[0.07] pb-2.5">
              <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
                {scenes.map((sc) => {
                  const selected = sc.id === state.sceneId;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => onSelectScene(sc.id)}
                      className={`group flex items-center gap-2 rounded-lg border px-2 py-1 text-left transition-colors cursor-pointer shrink-0 ${
                        selected
                          ? 'border-[#E59838] bg-[#1C222F] text-white'
                          : 'border-white/[0.08] bg-[#171B24] text-[#9AA4B4] hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <img
                        src={sc.imageUrl}
                        alt={sc.title}
                        referrerPolicy="no-referrer"
                        className="h-6 w-10 rounded object-cover bg-[#0B0D10]"
                      />
                      <span className="text-xs font-medium whitespace-nowrap pr-1">
                        {sc.title}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Загрузить собственное изображение"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#1A1F2B] px-3 py-1.5 text-xs font-medium text-[#E4E8F0] hover:bg-[#232A39] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Загрузить</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenRecipe}
                  className="flex items-center gap-1.5 rounded-md border border-[#E59838]/40 bg-[#251E15] px-3 py-1.5 text-xs font-medium text-[#F4B867] hover:bg-[#31271A] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  <span>Рецепт JSON</span>
                </button>
              </div>
            </div>

            {/* Row 2: Camera Motion + Play/Pause + Atmosphere */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateState({ isPlaying: !state.isPlaying })}
                  aria-label={state.isPlaying ? 'Пауза анимации' : 'Воспроизвести анимацию'}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.12] bg-[#1A1F2B] text-[#F5F7FA] hover:border-[#E59838] transition-colors cursor-pointer shrink-0"
                >
                  {state.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>

                <div
                  role="group"
                  aria-label="Траектория камеры"
                  className="flex min-w-0 items-center gap-1 rounded-lg bg-[#0D1016] p-1 border border-white/[0.06] overflow-x-auto"
                >
                  {MOTION_OPTIONS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onUpdateState({ motionPreset: m.id })}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        state.motionPreset === m.id
                          ? 'bg-[#E59838] text-[#0B0D10]'
                          : 'text-[#9AA4B4] hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8F98A8] whitespace-nowrap">Атмосфера</span>
                <div
                  role="group"
                  aria-label="3D-частицы атмосферы"
                  className="flex items-center gap-1 rounded-lg bg-[#0D1016] p-1 border border-white/[0.06]"
                >
                  {ATMOSPHERE_OPTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onUpdateState({ atmosphere: a.id })}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        state.atmosphere === a.id
                          ? 'bg-[#252C3B] text-white'
                          : 'text-[#8F98A8] hover:text-white'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: Optical & Parallax Sliders */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-0.5">
              <SliderControl
                id="slider-parallax"
                label="Сила параллакса"
                value={state.parallaxStrength}
                min={0.1}
                max={1.2}
                step={0.05}
                displayValue={`${Math.round(state.parallaxStrength * 100)}%`}
                onChange={(v) => onUpdateState({ parallaxStrength: v })}
              />
              <SliderControl
                id="slider-convergence"
                label="Фокус (Конвергенция)"
                value={state.convergence}
                min={0.1}
                max={0.9}
                step={0.02}
                displayValue={`${Math.round(state.convergence * 100)}%`}
                onChange={(v) => onUpdateState({ convergence: v })}
              />
              <SliderControl
                id="slider-dof"
                label="Глубина резкости (DoF)"
                value={state.dofAmount}
                min={0}
                max={1}
                step={0.05}
                displayValue={`${Math.round(state.dofAmount * 100)}%`}
                onChange={(v) => onUpdateState({ dofAmount: v })}
              />
              <SliderControl
                id="slider-speed"
                label="Скорость камеры"
                value={state.speed}
                min={0.2}
                max={2.0}
                step={0.1}
                displayValue={`${state.speed.toFixed(1)}×`}
                onChange={(v) => onUpdateState({ speed: v })}
              />
            </div>

            {/* Quiet unboxed metadata line */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8F98A8] pt-1 border-t border-white/[0.06]">
              <p className="truncate max-w-[740px]" title={cinematographyNote}>
                <span className="text-[#DCE2EC] font-medium">{activeSceneTitle}</span>
                <span aria-hidden="true" className="mx-2">·</span>
                <span>{cinematographyNote}</span>
              </p>
              <span className="font-mono tabular-nums whitespace-nowrap">
                {state.pipelineMode === 'pom'
                  ? hasCleanPlate
                    ? 'Режим: Гибрид POM + Clean Plate'
                    : 'Режим: Гибрид POM + Inpaint'
                  : state.pipelineMode === 'ldi'
                    ? 'Режим: LDI 3 слоя'
                    : 'Режим: 3D Разбор'}
              </span>
            </div>
          </div>
        )}

        {/* LAYERS & INPAINTING TAB */}
        {dockTab === 'layers' && (
          <div className="flex flex-col gap-3.5">
            {/* Pipeline Mode & Inpainting Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8F98A8] whitespace-nowrap">Рендер-конвейер</span>
                <div
                  role="group"
                  aria-label="Режим 2.5D рендеринга"
                  className="flex items-center gap-1 rounded-lg bg-[#0D1016] p-1 border border-white/[0.06]"
                >
                  {PIPELINE_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onUpdateState({ pipelineMode: p.id, depthOverlay: 'final' })}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        state.pipelineMode === p.id
                          ? 'bg-[#E59838] text-[#0B0D10]'
                          : 'text-[#9AA4B4] hover:text-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8F98A8] whitespace-nowrap">Заполнение фона</span>
                <div
                  role="group"
                  aria-label="Алгоритм заполнения пустых зон фона"
                  className="flex items-center gap-1 rounded-lg bg-[#0D1016] p-1 border border-white/[0.06]"
                >
                  {INPAINT_OPTIONS.map((inp) => (
                    <button
                      key={inp.id}
                      type="button"
                      onClick={() => onUpdateState({ inpaintMode: inp.id })}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        state.inpaintMode === inp.id
                          ? 'bg-[#252C3B] text-white'
                          : 'text-[#8F98A8] hover:text-white'
                      }`}
                    >
                      {inp.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sliders + 3 Live Diagnostic Layer Plates */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
              <div className="lg:col-span-6 grid grid-cols-2 gap-3.5">
                <SliderControl
                  id="slider-fg-cut"
                  label="Порог переднего плана"
                  value={state.foregroundCut}
                  min={0.4}
                  max={0.88}
                  step={0.02}
                  displayValue={`${Math.round(state.foregroundCut * 100)}%`}
                  onChange={(v) => onUpdateState({ foregroundCut: v })}
                />
                <SliderControl
                  id="slider-mid-cut"
                  label="Порог среднего плана"
                  value={state.midgroundCut}
                  min={0.14}
                  max={0.62}
                  step={0.02}
                  displayValue={`${Math.round(state.midgroundCut * 100)}%`}
                  onChange={(v) => onUpdateState({ midgroundCut: v })}
                />
                <SliderControl
                  id="slider-z-sep"
                  label="Разнос слоёв (Z)"
                  value={state.layerSeparation}
                  min={0.15}
                  max={1.0}
                  step={0.05}
                  displayValue={`${Math.round(state.layerSeparation * 100)}%`}
                  onChange={(v) => onUpdateState({ layerSeparation: v })}
                />
                <SliderControl
                  id="slider-feather"
                  label="Растушёвка краёв"
                  value={state.edgeFeather}
                  min={0.02}
                  max={0.16}
                  step={0.01}
                  displayValue={`${Math.round(state.edgeFeather * 100)}%`}
                  onChange={(v) => onUpdateState({ edgeFeather: v })}
                />
              </div>

              {/* Real-time LDI & Disocclusion Inpainting Inspector Thumbnails */}
              <div className="lg:col-span-6 grid grid-cols-3 gap-2.5">
                <div className="flex flex-col gap-1">
                  <div className="h-16 w-full overflow-hidden rounded-md border border-white/10 bg-[#0B0D10]">
                    {ldiAssets ? (
                      <img
                        src={ldiAssets.foregroundPreviewUrl}
                        alt="Вырезанный передний слой"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-[#161A22]" />
                    )}
                  </div>
                  <span className="text-[11px] text-[#9AA4B4] truncate">Передний слой (FG)</span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="h-16 w-full overflow-hidden rounded-md border border-white/10 bg-[#0B0D10]">
                    {ldiAssets ? (
                      <img
                        src={ldiAssets.holeMaskPreviewUrl}
                        alt="Зона дисокклюзии фона"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-[#161A22]" />
                    )}
                  </div>
                  <span className="text-[11px] text-[#9AA4B4] truncate">Зона разрыва (Hole)</span>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="h-16 w-full overflow-hidden rounded-md border border-[#E59838]/40 bg-[#0B0D10]">
                    {ldiAssets ? (
                      <img
                        src={ldiAssets.inpaintedPreviewUrl}
                        alt="Восстановленный фон Inpaint"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-[#161A22]" />
                    )}
                  </div>
                  <span className="text-[11px] text-[#F4B867] truncate">
                    {ldiAssets?.usingCleanPlate ? 'Clean Plate (HD)' : 'Заполненный фон'}
                  </span>
                </div>
              </div>
            </div>

            {/* Unboxed quantitative summary + Clean Plate override */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8F98A8] pt-1 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span>Зона дисокклюзии: {ldiAssets ? `${ldiAssets.holeCoveragePercent}%` : '—'}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {ldiAssets?.usingCleanPlate
                    ? 'Источник: HD Clean Plate'
                    : `Восстановлено пикселей: ${ldiAssets ? ldiAssets.filledPixels.toLocaleString('ru-RU') : '—'}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  ref={cleanPlateInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  aria-label="Загрузить чистый фон Clean Plate"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onUploadCleanPlate(file);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => cleanPlateInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs font-medium text-[#DCE2EC] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Layers className="h-3.5 w-3.5 text-[#E59838]" />
                  <span>{hasCleanPlate ? 'Заменить Clean Plate' : 'Загрузить чистый фон'}</span>
                </button>
                {hasCleanPlate && (
                  <button
                    type="button"
                    onClick={onClearCleanPlate}
                    className="text-xs text-[#9AA4B4] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Сбросить фон
                  </button>
                )}
                <button
                  type="button"
                  onClick={onRecomputeLdi}
                  className="text-xs font-medium text-[#E59838] hover:text-[#F4B867] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Пересчитать
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DEPTH MAP SCULPTING TAB */}
        {dockTab === 'depth' && (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8F98A8] whitespace-nowrap">Визуализация</span>
                <div
                  role="group"
                  aria-label="Режим просмотра карты глубины"
                  className="flex items-center gap-1 rounded-lg bg-[#0D1016] p-1 border border-white/[0.06]"
                >
                  {OVERLAY_OPTIONS.map((ov) => (
                    <button
                      key={ov.id}
                      type="button"
                      onClick={() => onUpdateState({ depthOverlay: ov.id })}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        state.depthOverlay === ov.id
                          ? 'bg-[#E59838] text-[#0B0D10]'
                          : 'text-[#9AA4B4] hover:text-white'
                      }`}
                    >
                      {ov.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8F98A8] whitespace-nowrap">Кисть глубины</span>
                <div
                  role="group"
                  aria-label="Инструмент кисти глубины"
                  className="flex items-center gap-1 rounded-lg bg-[#0D1016] p-1 border border-white/[0.06]"
                >
                  {BRUSH_OPTIONS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onUpdateState({ brushTool: b.id })}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        state.brushTool === b.id
                          ? 'bg-[#252C3B] text-white'
                          : 'text-[#8F98A8] hover:text-white'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <SliderControl
                id="slider-brush-radius"
                label="Размер кисти"
                value={state.brushRadius}
                min={0.03}
                max={0.22}
                step={0.01}
                displayValue={`${Math.round(state.brushRadius * 100)} px`}
                onChange={(v) => onUpdateState({ brushRadius: v })}
              />
              <SliderControl
                id="slider-brush-strength"
                label="Нажим кисти"
                value={state.brushStrength}
                min={0.15}
                max={1.0}
                step={0.05}
                displayValue={`${Math.round(state.brushStrength * 100)}%`}
                onChange={(v) => onUpdateState({ brushStrength: v })}
              />
              <SliderControl
                id="slider-depth-contrast"
                label="Контраст глубины"
                value={state.depthContrast}
                min={0.6}
                max={1.6}
                step={0.05}
                displayValue={`${state.depthContrast.toFixed(2)}×`}
                onChange={(v) => onUpdateState({ depthContrast: v })}
              />

              <div className="flex items-center justify-end gap-2">
                <input
                  ref={depthInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  aria-label="Загрузить карту глубины PNG"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onUploadDepthMap(file);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => depthInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-md border border-[#E59838]/40 bg-[#251E15] px-2.5 py-2 text-xs font-medium text-[#F4B867] hover:bg-[#31271A] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>{hasExternalDepth ? 'Сменить PNG' : 'Карта PNG'}</span>
                </button>
                <button
                  type="button"
                  onClick={onResetDepth}
                  className="flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#1A1F2B] px-2.5 py-2 text-xs font-medium text-[#E4E8F0] hover:bg-[#232A39] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Сбросить</span>
                </button>
              </div>
            </div>

            <p className="text-xs text-[#8F98A8] pt-1 border-t border-white/[0.06]">
              Рисуйте прямо на кадре (белый — ближе, чёрный — дальше) или импортируйте готовую Ч/Б карту PNG (Depth Anything / Blender) — RGB Guided Filter автоматически привяжет её к контурам.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
