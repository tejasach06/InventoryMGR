'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inputClass } from './ui';

interface FuzzyMultiSelectProps {
  value: string[];
  options: string[];
  onChange: (val: string[]) => void;
  placeholder: string;
  labels?: Record<string, string>;
}

function fuzzyMatch(options: string[], query: string): string[] {
  if (!query) return options;
  const q = query.toLowerCase();
  return options.filter((opt) => opt.toLowerCase().includes(q));
}

export function FuzzyMultiSelect({
  value,
  options,
  onChange,
  placeholder,
  labels,
}: FuzzyMultiSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 240; // matches max-h-60
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipAbove = spaceBelow < panelHeight + 4 && rect.top > panelHeight + 4;
    setPos({
      top: flipAbove ? rect.top - panelHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, [open, query, value]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        inputRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = fuzzyMatch(options, query);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      setHighlightedIndex(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
        const opt = filtered[highlightedIndex];
        if (!value.includes(opt)) {
          onChange([...value, opt]);
        }
        setQuery('');
        setHighlightedIndex(-1);
      } else if (query.trim()) {
        const trimmed = query.trim();
        if (!value.includes(trimmed)) {
          onChange([...value, trimmed]);
        }
        setQuery('');
        setHighlightedIndex(-1);
      }
      return;
    }
    if (e.key === 'Backspace' && !query && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (!open) setOpen(true);
    setHighlightedIndex(0);
  }

  function addValue(val: string) {
    if (!value.includes(val)) {
      onChange([...value, val]);
    }
    setQuery('');
    setHighlightedIndex(-1);
  }

  function removeValue(val: string) {
    onChange(value.filter((v) => v !== val));
  }

  const panel = (
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 100 }}
      className="animate-rise max-h-60 overflow-auto rounded-lg border border-[var(--color-border)]/70 bg-white shadow-[var(--shadow-overlay)] dark:border-[var(--color-border)] dark:bg-slate-900"
    >
      {filtered.length === 0 && query && (
        <div className="px-3 py-2 text-sm text-[var(--color-text-tertiary)]">
          No matches for "{query}" — press Enter to add as custom value
        </div>
      )}
      {filtered.map((opt, idx) => (
        <button
          key={opt}
          type="button"
          onClick={() => addValue(opt)}
          className={`w-full text-left px-3 py-2 text-sm transition-colors duration-100 ${
            idx === highlightedIndex
              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative" ref={containerRef}>
    <div className="flex flex-wrap gap-1.5 mb-1 items-center">
        {value.map((val, i) => (
          <span key={i} className="animate-pill-pop inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-accent)] transition-all duration-150">
            {labels?.[val] ?? val}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeValue(val);
              }}
              className="ml-0.5 rounded p-0.5 hover:bg-[var(--color-accent)]/20 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              aria-label={`Remove ${labels?.[val] ?? val}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={value.length === 0 ? placeholder : ''}
          className={`flex-1 min-w-[120px] ${inputClass}`}
          aria-autocomplete="list"
          aria-expanded={open}
        />
      </div>
      {mounted && open ? (createPortal(panel, document.body) as any) : null}
    </div>
  );
}