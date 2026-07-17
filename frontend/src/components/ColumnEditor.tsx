'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColumnConfig, COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { secondaryButtonClass } from './ui';

interface ColumnEditorProps {
  columns: ColumnConfig[];
  onToggle: (key: string) => void;
  onReorder: (fromKey: string, toKey: string) => void;
  onReset: () => void;
}

export function ColumnEditor({ columns, onToggle, onReorder, onReset }: ColumnEditorProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const sorted = [...columns].sort((a, b) => a.order - b.order);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleDragStart(e: React.DragEvent, key: string) {
    setDraggedKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  }

  function handleDragOver(e: React.DragEvent, key: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (key !== draggedKey) {
      setDragOverKey(key);
    }
  }

  function handleDragEnd() {
    setDraggedKey(null);
    setDragOverKey(null);
  }

  function handleDrop(e: React.DragEvent, toKey: string) {
    e.preventDefault();
    if (draggedKey && draggedKey !== toKey) {
      onReorder(draggedKey, toKey);
    }
    setDraggedKey(null);
    setDragOverKey(null);
  }

  const panel = (
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 100 }}
      className="animate-rise w-60 max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--color-border)]/70 bg-white p-2 shadow-[var(--shadow-overlay)] dark:border-[var(--color-border)] dark:bg-slate-900"
    >
      <p className="eyebrow-label px-2 pb-1.5 pt-1">Visible Columns</p>
      {sorted.map((col) => (
        <div
          key={col.key}
          draggable
          onDragStart={(e) => handleDragStart(e, col.key)}
          onDragOver={(e) => handleDragOver(e, col.key)}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e, col.key)}
          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-move select-none transition-colors duration-150 hover:bg-[var(--color-surface-tertiary)] dark:hover:bg-slate-800 ${
            dragOverKey === col.key ? 'border-t-2 border-[var(--color-accent)]' : 'border-t-2 border-transparent'
          } ${draggedKey === col.key ? 'opacity-50' : ''}`}
        >
          <svg className="h-3.5 w-3.5 shrink-0 cursor-grab text-[var(--color-text-tertiary)]" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
            <title>Drag to reorder</title>
            <circle cx="2.5" cy="2.5" r="1.25" /><circle cx="7.5" cy="2.5" r="1.25" />
            <circle cx="2.5" cy="8" r="1.25" /><circle cx="7.5" cy="8" r="1.25" />
            <circle cx="2.5" cy="13.5" r="1.25" /><circle cx="7.5" cy="13.5" r="1.25" />
          </svg>
          <label className="flex-1 cursor-pointer text-[var(--color-text-primary)] dark:text-slate-200">
            <input
              type="checkbox"
              checked={col.visible}
              onChange={() => onToggle(col.key)}
              className="mr-2 h-3.5 w-3.5 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            {COLUMN_LABELS[col.key] ?? col.key}
          </label>
        </div>
      ))}
      <div className="mt-2 border-t border-[var(--color-border)] pt-2 dark:border-[var(--color-border)]/60">
        <button
          type="button"
          onClick={onReset}
          className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors dark:hover:bg-slate-800"
        >
          Reset to default
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={secondaryButtonClass}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <line x1="6" y1="2" x2="6" y2="14" />
          <line x1="10" y1="2" x2="10" y2="14" />
        </svg>
        Columns
      </button>
      {mounted && open ? createPortal(panel, document.body) : null}
    </>
  );
}