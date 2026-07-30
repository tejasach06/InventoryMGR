'use client';

import { useState } from 'react';
import { Drawer, secondaryButtonClass } from './ui';
import { cn } from '../lib/classNames';
import { COLUMN_LABELS, type ColumnConfig } from '../hooks/useColumnPreferences';

export function ColumnDrawer({
  open,
  columns,
  onClose,
  onToggle,
  onReorder,
  onReset,
}: {
  open: boolean;
  columns: ColumnConfig[];
  onClose: () => void;
  onToggle: (key: string) => void;
  onReorder: (fromKey: string, toKey: string) => void;
  onReset: () => void;
}) {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const sorted = [...columns].sort((a, b) => a.order - b.order);
  const visibleCount = columns.filter((c) => c.visible).length;

  function handleDragStart(e: React.DragEvent, key: string) {
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  }

  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (key !== draggedKey) setDragOverKey(key);
  }

  function handleDrop(e: React.DragEvent, toKey: string) {
    e.preventDefault();
    if (draggedKey && draggedKey !== toKey) onReorder(draggedKey, toKey);
    setDraggedKey(null);
    setDragOverKey(null);
  }

  function handleDragEnd() {
    setDraggedKey(null);
    setDragOverKey(null);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Columns"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button type="button" onClick={onReset} className={cn(secondaryButtonClass, 'text-xs')}>
            Reset to default
          </button>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Done
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-[var(--color-text-tertiary)] dark:text-slate-400">
        {visibleCount} of {columns.length} columns shown. Drag or use arrow buttons to reorder.
      </p>
      <ul className="space-y-0.5">
        {sorted.map((col) => (
          <li
            key={col.key}
            draggable
            onDragStart={(e) => handleDragStart(e, col.key)}
            onDragOver={(e) => handleDragOver(e, col.key)}
            onDrop={(e) => handleDrop(e, col.key)}
            onDragEnd={handleDragEnd}
            className={cn(
              'flex cursor-move select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150',
              'hover:bg-[var(--color-surface-tertiary)] dark:hover:bg-slate-800',
              dragOverKey === col.key && 'bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]',
              draggedKey === col.key && 'opacity-50',
            )}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0 cursor-grab text-[var(--color-text-tertiary)]"
              viewBox="0 0 10 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="2.5" cy="2.5" r="1.25" /><circle cx="7.5" cy="2.5" r="1.25" />
              <circle cx="2.5" cy="8" r="1.25" /><circle cx="7.5" cy="8" r="1.25" />
              <circle cx="2.5" cy="13.5" r="1.25" /><circle cx="7.5" cy="13.5" r="1.25" />
            </svg>
            <input
              id={`column-${col.key}`}
              type="checkbox"
              checked={col.visible}
              onChange={() => onToggle(col.key)}
              className="h-3.5 w-3.5 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            <label
              htmlFor={`column-${col.key}`}
              className="flex-1 cursor-pointer text-[var(--color-text-primary)] dark:text-slate-200"
            >
              {COLUMN_LABELS[col.key] ?? col.key}
            </label>
            <div className="ml-auto flex items-center gap-0.5 opacity-70 hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={() => {
                  const idx = sorted.findIndex((c) => c.key === col.key);
                  if (idx > 0) onReorder(col.key, sorted[idx - 1].key);
                }}
                disabled={sorted.findIndex((c) => c.key === col.key) === 0}
                className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-25 transition-colors rounded hover:bg-[var(--color-surface-tertiary)] dark:hover:bg-slate-700"
                aria-label={`Move ${COLUMN_LABELS[col.key] ?? col.key} up`}
                title="Move up"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l4-4 4 4"/></svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = sorted.findIndex((c) => c.key === col.key);
                  if (idx < sorted.length - 1) onReorder(col.key, sorted[idx + 1].key);
                }}
                disabled={sorted.findIndex((c) => c.key === col.key) === sorted.length - 1}
                className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-25 transition-colors rounded hover:bg-[var(--color-surface-tertiary)] dark:hover:bg-slate-700"
                aria-label={`Move ${COLUMN_LABELS[col.key] ?? col.key} down`}
                title="Move down"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6l4 4 4-4"/></svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
