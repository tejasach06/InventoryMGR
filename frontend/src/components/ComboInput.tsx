'use client';

import { useState } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';
import { cn } from '../lib/classNames';
import { FieldError, inputClass, labelClass } from './ui';

export function ComboInput({
  id,
  label,
  value,
  options,
  onChange,
  error,
  required = false,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  type?: string;
}) {
  const errorId = `${id}-error`;
  const listId = `${id}-listbox`;
  const raw = value ?? '';
  const query = raw.trim().toLowerCase();
  const matches = query.length > 0 ? fuzzyFilter(options, query) : [];
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const activeId =
    activeIndex >= 0 && activeIndex < matches.length ? `${id}-option-${activeIndex}` : undefined;
  const isNumericOrDate = type === 'number' || type === 'date';
  const listOpen = open && matches.length > 0;

  function selectMatch(m: string) {
    onChange(m);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectMatch(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      setActiveIndex(-1);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label className={labelClass} htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        className={cn(inputClass, isNumericOrDate && 'tabular-nums')}
        id={id}
        name={id}
        type={type}
        autoComplete="off"
        value={raw}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
      />
      {listOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-overlay)]"
        >
          {matches.map((m, i) => (
            <li
              key={m}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectMatch(m)}
                className={cn(
                  'block w-full px-3 py-2 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-tertiary)]',
                  i === activeIndex && 'bg-[var(--color-surface-tertiary)]'
                )}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
