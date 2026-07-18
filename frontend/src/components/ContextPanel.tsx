'use client';

import { cn } from '../lib/classNames';
import { cardClass, eyebrowClass, secondaryButtonClass } from './ui';

interface ContextPanelProps {
  selectedCount: number;
  onExportSelected: () => void;
  onClearSelected: () => void;
}

export function ContextPanel({ selectedCount, onExportSelected, onClearSelected }: ContextPanelProps) {
  if (selectedCount === 0) return null;

  return (
    <aside
      className="hidden lg:flex lg:sticky lg:top-8 lg:h-fit lg:w-full lg:max-w-full lg:flex-col lg:gap-5"
      aria-label="Inventory context panel"
    >
      <div className={cn(cardClass, 'p-5 border-[var(--color-accent)]/30 animate-fade-in')}>
        <p className={eyebrowClass}>Bulk Actions</p>
        <p className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)] dark:text-slate-50">
          {selectedCount} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">selected</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onExportSelected}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
          >
            Export selected
          </button>
          <button type="button" onClick={onClearSelected} className={secondaryButtonClass}>
            Clear selection
          </button>
        </div>
      </div>
    </aside>
  );
}
