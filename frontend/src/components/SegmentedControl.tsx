'use client';

import { cn } from '../lib/classNames';

interface SegmentedControlProps {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  labels?: Record<string, string>;
}

/**
 * Multi-select segmented control (pill group) for small, fixed enums.
 * Each pill is a real toggle button with a distinct selected/unselected
 * visual state, not a text input. Selection reads as an accent tint — the
 * control carries no semantic colour of its own.
 */
export function SegmentedControl({ label, options, value, onChange, labels }: SegmentedControlProps) {
  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-1 dark:bg-slate-900/60" role="group" aria-label={label}>
      {options.map((option) => {
        const active = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold leading-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
              active
                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] shadow-sm'
                : 'text-[var(--color-text-tertiary)] hover:bg-white hover:text-[var(--color-text-secondary)] dark:hover:bg-slate-800 dark:hover:text-slate-200'
            )}
          >
            {labels?.[option] ?? option}
          </button>
        );
      })}
    </div>
  );
}
