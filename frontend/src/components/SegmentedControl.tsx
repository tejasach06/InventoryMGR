'use client';

import { cn } from '../lib/classNames';

type SemanticType = 'status' | 'criticality' | 'platform';

interface SegmentedControlProps {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  type: SemanticType;
  labels?: Record<string, string>;
}

/**
 * Multi-select segmented control (pill group) for small, fixed enums —
 * Status / Platform / Criticality. Each pill is a real toggle button with a
 * distinct selected/unselected visual state, not a text input.
 */
export function SegmentedControl({ label, options, value, onChange, type, labels }: SegmentedControlProps) {
  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-1 dark:bg-slate-900/60" role="group" aria-label={label}>
      {options.map((option) => {
        const active = value.includes(option);
        const normalized = option.toLowerCase().replace(/\s+/g, '_');
        // Status and criticality are deliberately colourless; platform keeps
        // its semantic colour, matching how the inventory table renders them.
        const coloured = type === 'platform';
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold leading-none transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
              active
                ? cn('shadow-sm', !coloured && 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]')
                : 'text-[var(--color-text-tertiary)] hover:bg-white hover:text-[var(--color-text-secondary)] dark:hover:bg-slate-800 dark:hover:text-slate-200'
            )}
            style={active && coloured ? {
              backgroundColor: `var(--color-${type}-${normalized}-bg)`,
              color: `var(--color-${type}-${normalized})`,
            } as React.CSSProperties : undefined}
          >
            {coloured && (
              <span
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', !active && 'opacity-[0.55] dark:opacity-40')}
                style={{ backgroundColor: `var(--color-${type}-${normalized})` } as React.CSSProperties}
                aria-hidden="true"
              />
            )}
            {labels?.[option] ?? option}
          </button>
        );
      })}
    </div>
  );
}
