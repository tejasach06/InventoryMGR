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
        {visibleCount} of {columns.length} columns shown. Drag to reorder.
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
              'flex cursor-move select-none items-center gap-2 rounded-lg border-t-2 px-2 py-2 text-sm transition-colors duration-150',
              'hover:bg-[var(--color-surface-tertiary)] dark:hover:bg-slate-800',
              dragOverKey === col.key ? 'border-[var(--color-accent)]' : 'border-transparent',
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
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
