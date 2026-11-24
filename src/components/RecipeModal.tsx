import React, { useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy, Download, ImagePlus, Layers, Trash2, X } from 'lucide-react';
import type { StudioScenePreset } from '../engine/types';

interface RecipeModalProps {
  open: boolean;
  currentManifest: StudioScenePreset;
  hasExternalDepth: boolean;
  hasCleanPlate: boolean;
  invertExternalDepth: boolean;
  snapExternalDepth: boolean;
  onClose: () => void;
  onApplyJson: (rawJson: string) => { ok: true } | { ok: false; error: string };
  onUploadDepthMap: (file: File) => void;
  onClearDepthMap: () => void;
  onToggleInvertDepth: (invert: boolean) => void;
  onToggleSnapDepth: (snap: boolean) => void;
  onUploadCleanPlate: (file: File) => void;
  onClearCleanPlate: () => void;
}

export function RecipeModal({
  open,
  currentManifest,
  hasExternalDepth,
  hasCleanPlate,
  invertExternalDepth,
  snapExternalDepth,
  onClose,
  onApplyJson,
  onUploadDepthMap,
  onClearDepthMap,
  onToggleInvertDepth,
  onToggleSnapDepth,
  onUploadCleanPlate,
  onClearCleanPlate,
}: RecipeModalProps) {
  const [jsonDraft, setJsonDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [appliedToast, setAppliedToast] = useState(false);

  const depthInputRef = useRef<HTMLInputElement | null>(null);
  const cleanPlateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setJsonDraft(JSON.stringify(currentManifest, null, 2));
      setError(null);
      setAppliedToast(false);
    }
  }, [open, currentManifest]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonDraft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Не удалось скопировать в буфер обмена.');
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonDraft], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentManifest.id || 'scene'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleApply = () => {
    const res = onApplyJson(jsonDraft);
    if (!res.ok) {
      setError(res.error);
      setAppliedToast(false);
      return;
    }
    setError(null);
    setAppliedToast(true);
    window.setTimeout(() => setAppliedToast(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Рецепт сцены JSON и внешние пассы"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="flex max-h-[88vh] w-full max-w-[780px] flex-col overflow-hidden rounded-xl border border-white/[0.12] bg-[#131720] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Code2 className="h-4 w-4 text-[#E59838]" />
            <h2 className="text-sm font-semibold text-[#F5F7FA]">
              Рецепт сцены (JSON) и студийные пассы
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно рецепта"
            className="rounded-md p-1 text-[#9AA4B4] hover:bg-white/[0.06] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Studio Pass Overrides: External Depth Map + HD Clean Plate */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-b border-white/[0.08] bg-[#0F131B] px-5 py-3.5">
          {/* External Depth Pass */}
          <div className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-[#151A24] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#ECEFF4]">Внешняя карта глубины (PNG)</span>
              <span className="font-mono text-[11px] text-[#8F98A8]">
                {hasExternalDepth ? 'Активна' : 'Blueprint'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[#8F98A8]">
              Подключите готовую Ч/Б карту из Depth Anything, MiDaS, Blender или Photoshop (белый = ближе).
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <input
                ref={depthInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                aria-label="Загрузить внешнюю карту глубины PNG"
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
                className="flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#1C2230] px-2.5 py-1.5 text-xs font-medium text-[#ECEFF4] hover:bg-[#252D3F] transition-colors cursor-pointer"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                <span>{hasExternalDepth ? 'Заменить PNG' : 'Загрузить карту'}</span>
              </button>
              {hasExternalDepth && (
                <button
                  type="button"
                  onClick={onClearDepthMap}
                  className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1.5 text-xs text-[#9AA4B4] hover:text-white transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Сброс</span>
                </button>
              )}
            </div>
            {hasExternalDepth && (
              <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-[#B8C0CE]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={snapExternalDepth}
                    onChange={(e) => onToggleSnapDepth(e.target.checked)}
                    className="accent-[#E59838]"
                  />
                  <span>RGB Guided-выравнивание</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={invertExternalDepth}
                    onChange={(e) => onToggleInvertDepth(e.target.checked)}
                    className="accent-[#E59838]"
                  />
                  <span>Инвертировать Z</span>
                </label>
              </div>
            )}
          </div>

          {/* HD Clean Plate Override */}
          <div className="flex flex-col gap-2 rounded-lg border border-white/[0.08] bg-[#151A24] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#ECEFF4]">Чистый фон (HD Clean Plate)</span>
              <span className="font-mono text-[11px] text-[#E59838]">
                {hasCleanPlate ? 'Подключён' : 'Авто Inpaint'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[#8F98A8]">
              Фон с удалённым объектом переднего плана (Generative Fill). Убирает любые следы диффузии на краях.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
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
                className="flex items-center gap-1.5 rounded-md border border-[#E59838]/40 bg-[#251E15] px-2.5 py-1.5 text-xs font-medium text-[#F4B867] hover:bg-[#31271A] transition-colors cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>{hasCleanPlate ? 'Заменить Clean Plate' : 'Загрузить чистый фон'}</span>
              </button>
              {hasCleanPlate && (
                <button
                  type="button"
                  onClick={onClearCleanPlate}
                  className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1.5 text-xs text-[#9AA4B4] hover:text-white transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Убрать</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* JSON Blueprint Editor */}
        <div className="flex flex-1 flex-col gap-2 overflow-hidden px-5 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="scene-recipe-json" className="text-xs font-medium text-[#C7CDD8]">
              Декларативный манифест сцены (совместим с <span className="font-mono text-[#E59838]">src/scenes/*.json</span>)
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-md border border-white/[0.1] bg-[#1A1F2B] px-2.5 py-1 text-xs text-[#DCE2EC] hover:bg-[#232A39] transition-colors cursor-pointer"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Скопировано' : 'Копировать'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="flex items-center gap-1 rounded-md border border-white/[0.1] bg-[#1A1F2B] px-2.5 py-1 text-xs text-[#DCE2EC] hover:bg-[#232A39] transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Скачать .json</span>
              </button>
            </div>
          </div>

          <textarea
            id="scene-recipe-json"
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            spellCheck={false}
            className="min-h-[240px] flex-1 resize-none rounded-lg border border-white/[0.1] bg-[#0B0D10] p-3 font-mono text-xs leading-relaxed text-[#DCE2EC] focus:border-[#E59838] focus:outline-none"
          />

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-200"
            >
              {error}
            </div>
          )}

          {appliedToast && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-950/35 px-3 py-2 text-xs text-emerald-200">
              Рецепт применён — карта глубины и слои пересчитаны в реальном времени.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-3">
          <p className="text-[11px] text-[#8F98A8]">
            Поддерживает полный манифест сцены или отдельный объект <span className="font-mono">blueprint</span>.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-white/[0.12] px-3.5 py-1.5 text-xs font-medium text-[#C7CDD8] hover:text-white transition-colors cursor-pointer"
            >
              Закрыть
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="rounded-md bg-[#E59838] px-4 py-1.5 text-xs font-semibold text-[#0B0D10] hover:bg-[#F0A94E] transition-colors cursor-pointer"
            >
              Применить рецепт
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
