'use client';

import { useRef, useState } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';
import { cn } from '../lib/classNames';
import { inputClass } from './ui';
export function TagInput({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string[];
  options: string[];
  onChange: (tags: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const availableOptions = options.filter((o) => !value.includes(o));
  const matches = query.trim().length > 0 ? fuzzyFilter(availableOptions, query.trim()) : [];
  const listId = `${id}-listbox`;
  const activeId =
    activeIndex >= 0 && activeIndex < matches.length ? `${id}-option-${activeIndex}` : undefined;
  const listOpen = open && matches.length > 0;

  function normalizeTag(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.+-]/g, '-');
  }

  function commitTags(tagsToAdd: string[]) {
    const next = [...value];
    for (const raw of tagsToAdd) {
      const normalized = normalizeTag(raw);
      if (normalized && !next.includes(normalized)) {
        next.push(normalized);
      }
    }
    onChange(next);
    setQuery('');
    setActiveIndex(-1);
  }

  function removeTag(tagToRemove: string) {
    onChange(value.filter((t) => t !== tagToRemove));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
      return;
    }
    if (e.key === 'ArrowUp' && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Escape') {
      setActiveIndex(-1);
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < matches.length) {
        commitTags([matches[activeIndex]]);
      } else if (query.trim().length > 0) {
        commitTags([query]);
      }
      return;
    }
    if (e.key === ',' || e.key === ';') {
      e.preventDefault();
      if (query.trim().length > 0) {
        commitTags([query]);
      }
      return;
    }
    if (e.key === 'Tab' && query.trim().length > 0) {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < matches.length) {
        commitTags([matches[activeIndex]]);
      } else {
        commitTags([query]);
      }
      return;
    }
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (text.includes(',') || text.includes(';')) {
      e.preventDefault();
      const parts = text.split(/[,;]/);
      commitTags(parts);
    }
  }

  return (
    <div className="relative">
      <div
        className={cn(
          inputClass,
          'flex min-h-[38px] flex-wrap items-center gap-1.5 py-1.5 cursor-text'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 text-xs text-[var(--color-text-tertiary)]"
          >
            <span>{tag}</span>
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="hover:text-[var(--color-text-primary)] focus:outline-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          name={id}
          type="text"
          autoComplete="off"
          value={query}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="min-w-[80px] flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        />
      </div>

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
                onClick={() => commitTags([m])}
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
    </div>
  );
}
