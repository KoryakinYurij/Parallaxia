import React from 'react';
import type { WorkspaceTab } from '../engine/types';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenExport: () => void;
}

const NAV_ITEMS: ReadonlyArray<{ id: WorkspaceTab; label: string }> = [
  { id: 'scene', label: 'Сцена' },
  { id: 'layers', label: 'Слои и Inpaint' },
  { id: 'depth', label: 'Карта глубины' },
  { id: 'techniques', label: 'Методики' },
];

export function TopBar({ activeTab, onSelectTab, onOpenExport }: TopBarProps) {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-8 border-b border-white/[0.08] bg-[#0F1218] px-4 sm:px-6">
      {/* Zone 1: Single-line brand wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectTab('scene');
        }}
        className="font-display text-lg font-bold tracking-tight text-[#F5F7FA] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E59838] focus-visible:outline-offset-4 rounded"
      >
        Parallaxia
      </a>

      {/* Zone 2: 4 clean single-line navigation links */}
      <nav
        aria-label="Разделы студии"
        className="flex items-center gap-4 sm:gap-7 overflow-x-auto no-scrollbar"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative py-4 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E59838] ${
                active
                  ? 'text-[#F5F7FA]'
                  : 'text-[#8F98A8] hover:text-[#DCE2EC]'
              }`}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-[#E59838]"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single primary action button */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenExport}
          className="rounded-md bg-[#E59838] px-4 py-2 text-xs sm:text-sm font-semibold text-[#0B0D10] hover:bg-[#EEAA52] active:bg-[#D5892A] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
        >
          Экспорт
        </button>
      </div>
    </header>
  );
}
