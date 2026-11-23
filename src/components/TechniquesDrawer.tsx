import React from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { PRO_TECHNIQUES } from '../engine/presets';
import type { StudioState } from '../engine/types';

interface TechniquesDrawerProps {
  open: boolean;
  onClose: () => void;
  onApplyTechnique: (patch: Partial<StudioState>) => void;
}

export function TechniquesDrawer({ open, onClose, onApplyTechnique }: TechniquesDrawerProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="techniques-title"
      className="fixed inset-0 z-40 flex justify-end bg-black/65"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="studio-scroll flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-white/[0.1] bg-[#11141B] p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <h2
              id="techniques-title"
              className="font-display text-2xl font-bold tracking-tight text-[#F5F7FA]"
              style={{ textWrap: 'balance' }}
            >
              Профессиональные методики 2.5D-анимации
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#9AA4B4]">
              Пять ключевых техник из пайплайнов VFX-студий (After Effects, Nuke, DepthFlow,
              3D Photo Inpainting). Любую методику можно сразу применить к текущей сцене.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть справочник методик"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.1] bg-[#181C26] text-[#B8C0CE] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex flex-col divide-y divide-white/[0.08]">
          {PRO_TECHNIQUES.map((tech) => (
            <article key={tech.id} className="py-6 first:pt-0 last:pb-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-base sm:text-lg font-semibold text-[#F5F7FA]">
                  <span className="font-mono text-[#E59838] mr-2">{tech.index}.</span>
                  {tech.title}
                </h3>
              </div>

              <p className="mt-1.5 text-xs text-[#8F98A8]">{tech.industryTools}</p>

              <p className="mt-3 text-sm leading-relaxed text-[#D4DAE4]">{tech.summary}</p>
              <p className="mt-2 text-sm leading-relaxed text-[#9AA4B4]">{tech.howItWorks}</p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#C7CDD8] max-w-md">{tech.proTip}</p>
                <button
                  type="button"
                  onClick={() => {
                    onApplyTechnique(tech.applyPatch);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#E59838] px-3.5 py-2 text-xs font-semibold text-[#0B0D10] hover:bg-[#EEAA52] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Применить в студии</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
