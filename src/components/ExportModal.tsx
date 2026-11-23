import React, { useState } from 'react';
import { Download, Film, Image as ImageIcon, Layers, X } from 'lucide-react';

interface ExportModalProps {
  open: boolean;
  sceneTitle: string;
  onClose: () => void;
  onRecordWebm: (durationSec: number, onProgress: (p: number) => void) => Promise<Blob>;
  onDownloadFramePng: () => void;
  onDownloadDepthPng: () => void;
  onDownloadInpaintedBgPng: () => void;
}

export function ExportModal({
  open,
  sceneTitle,
  onClose,
  onRecordWebm,
  onDownloadFramePng,
  onDownloadDepthPng,
  onDownloadInpaintedBgPng,
}: ExportModalProps) {
  const [durationSec, setDurationSec] = useState<number>(4);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedMsg, setCompletedMsg] = useState<string | null>(null);

  if (!open) return null;

  const slug = sceneTitle
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-|-$/g, '') || 'scene';

  const handleRecord = async () => {
    setErrorMsg(null);
    setCompletedMsg(null);
    setRecording(true);
    setProgress(0);
    try {
      const blob = await onRecordWebm(durationSec, (p) => setProgress(p));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parallaxia-${slug}-${durationSec}s.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setCompletedMsg(`Видео (${durationSec} сек, WebM) успешно сохранено.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось записать видео.');
    } finally {
      setRecording(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !recording) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-white/[0.1] bg-[#131720] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div>
            <h2
              id="export-modal-title"
              className="font-display text-lg font-bold text-[#F5F7FA]"
            >
              Экспорт 2.5D-анимации и пассов
            </h2>
            <p className="mt-1 text-xs text-[#8F98A8]">
              Сцена: {sceneTitle}
            </p>
          </div>
          <button
            type="button"
            disabled={recording}
            onClick={onClose}
            aria-label="Закрыть окно экспорта"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] bg-[#1B202C] text-[#9AA4B4] hover:text-white disabled:opacity-40 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Section 1: WebM Video Loop */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#ECEFF4]">Запись видео (WebM, 30 fps)</span>
            <div className="flex items-center gap-1 rounded-md bg-[#0D1016] p-1 border border-white/[0.06]">
              {[4, 6, 8].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  disabled={recording}
                  onClick={() => setDurationSec(sec)}
                  className={`rounded px-2.5 py-1 text-xs font-mono tabular-nums cursor-pointer transition-colors ${
                    durationSec === sec
                      ? 'bg-[#252C3B] text-white'
                      : 'text-[#8F98A8] hover:text-white'
                  }`}
                >
                  {sec} сек
                </button>
              ))}
            </div>
          </div>

          {recording && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-[#9AA4B4] mb-1.5 font-mono tabular-nums">
                <span>Идёт захват WebGL-потока...</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-[#E59838] transition-all duration-100"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <p role="alert" className="mt-3 text-xs text-amber-300">
              {errorMsg}
            </p>
          )}
          {completedMsg && (
            <p className="mt-3 text-xs text-emerald-300">{completedMsg}</p>
          )}

          <button
            type="button"
            disabled={recording}
            onClick={handleRecord}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[#E59838] px-4 py-2.5 text-sm font-semibold text-[#0B0D10] hover:bg-[#EEAA52] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Film className="h-4 w-4" />
            <span>{recording ? 'Запись видео...' : `Записать видео (${durationSec} сек)`}</span>
          </button>
        </div>

        {/* Section 2: Compositing Passes (PNG) */}
        <div className="mt-6 border-t border-white/[0.08] pt-5">
          <p className="text-xs font-medium text-[#8F98A8] mb-3">
            Отдельные пассы для After Effects / Nuke / Blender
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={onDownloadFramePng}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-white/[0.08] bg-[#181C26] p-3 text-left hover:border-white/25 transition-colors cursor-pointer"
            >
              <ImageIcon className="h-4 w-4 text-[#E59838]" />
              <span className="text-xs font-medium text-[#ECEFF4]">2.5D кадр</span>
              <span className="text-[11px] text-[#8F98A8]">Текущий рендер PNG</span>
            </button>

            <button
              type="button"
              onClick={onDownloadDepthPng}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-white/[0.08] bg-[#181C26] p-3 text-left hover:border-white/25 transition-colors cursor-pointer"
            >
              <Download className="h-4 w-4 text-[#E59838]" />
              <span className="text-xs font-medium text-[#ECEFF4]">Карта глубины</span>
              <span className="text-[11px] text-[#8F98A8]">Grayscale Depth PNG</span>
            </button>

            <button
              type="button"
              onClick={onDownloadInpaintedBgPng}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-white/[0.08] bg-[#181C26] p-3 text-left hover:border-white/25 transition-colors cursor-pointer"
            >
              <Layers className="h-4 w-4 text-[#E59838]" />
              <span className="text-xs font-medium text-[#ECEFF4]">Фон (Inpaint)</span>
              <span className="text-[11px] text-[#8F98A8]">Чистая подложка PNG</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
