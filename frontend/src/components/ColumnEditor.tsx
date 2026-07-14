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
      className="w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      {sorted.map((col, idx) => (
        <div
          key={col.key}
          draggable
          onDragStart={(e) => handleDragStart(e, col.key)}
          onDragOver={(e) => handleDragOver(e, col.key)}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e, col.key)}
          className={`flex items-center gap-2 px-2 py-1 text-sm cursor-move select-none ${
            dragOverKey === col.key ? 'border-t-2 border-indigo-500' : ''
          } ${draggedKey === col.key ? 'opacity-50' : ''}`}
        >
          <span className="text-slate-400 cursor-grab" title="Drag to reorder">
            ⋮⋮
          </span>
          <label className="flex-1 cursor-pointer">
            <input
              type="checkbox"
              checked={col.visible}
              onChange={() => onToggle(col.key)}
              className="mr-2"
            />
            {COLUMN_LABELS[col.key] ?? col.key}
          </label>
        </div>
      ))}
      <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
        <button
          type="button"
          onClick={onReset}
          className="w-full text-left px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
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