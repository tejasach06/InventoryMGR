'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Vm } from '../api/types';
import {
  Badge,
  Spinner,
  inputClass,
  monoClass,
  selectClass,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableRowClass,
  tableWrapClass,
} from './ui';
import { COLUMN_LABELS } from '../hooks/useColumnPreferences';
import { SORTABLE_COLUMNS, humanize } from '../lib/inventoryFilters';
import { formatMemory } from '../lib/units';
import { cn } from '../lib/classNames';

export type EditableField = 'status' | 'environment' | 'criticality' | 'owner';
const EDITABLE_FIELDS: readonly EditableField[] = ['status', 'environment', 'criticality', 'owner'];

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  return (
    <svg className={cn('h-3 w-3 transition-opacity', direction ? 'opacity-100 text-[var(--color-accent)]' : 'opacity-30')} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      {direction === 'desc' ? (
        <path d="M3 4.5L6 8l3-3.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M3 7.5L6 4l3 3.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function VmTable({
  vms,
  columns,
  selectedIds,
  onToggle,
  onToggleAll,
  sortKey,
  sortDir,
  onSort,
  canEdit = false,
  onUpdateCell,
}: {
  vms: Vm[];
  columns: { key: string }[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  canEdit?: boolean;
  onUpdateCell?: (vmId: string, field: EditableField, value: string) => Promise<void>;
}) {
  const [editingCell, setEditingCell] = useState<{ vmId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const startEdit = (vmId: string, field: EditableField, initialVal: string, width: number) => {
    if (!canEdit) return;
    setEditingCell({ vmId, field });
    setEditValue(initialVal ?? '');
    setEditWidth(width);
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
    setEditWidth(null);
  };

  const commitEdit = async () => {
    if (!editingCell || !onUpdateCell) return;
    try {
      setIsSaving(true);
      await onUpdateCell(editingCell.vmId, editingCell.field as EditableField, editValue);
    } catch {
      // handled by parent toast/alert
    } finally {
      setIsSaving(false);
      setEditingCell(null);
      setEditWidth(null);
    }
  };
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < vms.length;
  }, [selectedIds, vms.length]);


  return (
    <div className={cn(tableWrapClass, 'max-h-[calc(100vh-18rem)] overflow-y-auto')}>
      <table className={tableClass} style={{ '--row-height': 'var(--row-height-comfortable)' } as React.CSSProperties}>
        <thead className={tableHeadClass}>
          <tr>
            <th scope="col" className="px-4 py-3 w-10">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                checked={selectedIds.size === vms.length && vms.length > 0}
                onChange={() => onToggleAll(vms.map((v) => v.id))}
                aria-label="Select all"
              />
            </th>
            {columns.map((col) => {
              const sortable = SORTABLE_COLUMNS.has(col.key);
              const active = sortKey === col.key;
              const ariaSort = sortable ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
              return (
                <th key={col.key} scope="col" className="px-4 py-3" aria-sort={ariaSort}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className="inline-flex items-center gap-1 font-medium uppercase tracking-[0.08em] text-[0.7rem] hover:text-[var(--color-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded"
                    >
                      {COLUMN_LABELS[col.key as keyof typeof COLUMN_LABELS] || col.key}
                      <SortIcon direction={active ? sortDir : null} />
                    </button>
                  ) : (
                    <span className="font-medium">{COLUMN_LABELS[col.key as keyof typeof COLUMN_LABELS] || col.key}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {vms.map((vm) => {
            const isSelected = selectedIds.has(vm.id);

            return (
              <tr
                key={vm.id}
                className={cn(tableRowClass, isSelected && 'bg-[var(--color-accent)]/10')}
                style={{ borderLeft: `3px solid var(--color-status-${vm.status.toLowerCase().replace(/\s+/g, '_')})` }}
              >
                <td className="py-3 pl-3 pr-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                    checked={isSelected}
                    onChange={() => onToggle(vm.id)}
                    aria-label={`Select ${vm.name}`}
                  />
                </td>
                {columns.map((col) => {
                  const isEditing = editingCell?.vmId === vm.id && editingCell?.field === col.key;
                  const isEditable = canEdit && EDITABLE_FIELDS.includes(col.key as EditableField);
                  return (
                    <td
                      key={col.key}
                      data-testid={`cell-${col.key}`}
                      className={cn(
                        tableCellClass,
                        col.key === 'name' && 'font-medium',
                        isEditable && !isEditing && 'group/cell cursor-pointer hover:bg-[var(--color-accent)]/10 transition-colors'
                      )}
                      title={isEditable && !isEditing ? 'Click to edit inline' : undefined}
                      style={isEditing ? { width: editWidth ?? undefined } : undefined}
                      onClick={(e) => {
                        if (isEditable && !isEditing) {
                          const currentVal = String(vm[col.key as EditableField] ?? '');
                          startEdit(vm.id, col.key as EditableField, currentVal, (e.currentTarget as HTMLTableCellElement).offsetWidth);
                        }
                      }}
                    >
                      {isEditing ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {col.key === 'status' && (
                            <select
                              autoFocus
                              className={cn(selectClass, 'px-2 py-1')}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['running', 'powered_off', 'decommissioned'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'environment' && (
                            <select
                              autoFocus
                              className={cn(selectClass, 'px-2 py-1')}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['production', 'development', 'testing', 'uat', 'dr', 'staging', 'sandbox'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'criticality' && (
                            <select
                              autoFocus
                              className={cn(selectClass, 'px-2 py-1')}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            >
                              {['critical', 'high', 'medium', 'low'].map((opt) => (
                                <option key={opt} value={opt}>{humanize(opt)}</option>
                              ))}
                            </select>
                          )}
                          {col.key === 'owner' && (
                            <input
                              autoFocus
                              type="text"
                              className={cn(inputClass, 'px-2 py-1')}
                              value={editValue}
                              disabled={isSaving}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              onBlur={commitEdit}
                            />
                          )}
                          {isSaving ? <Spinner /> : null}
                        </div>
                      ) : (
                        <>
                          {col.key === 'name' && (
                            <Link href={`/inventory/${vm.id}`} className={cn(monoClass, "font-medium text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent-text)]")}>
                              {vm.name}
                            </Link>
                          )}
                          {col.key === 'platform' && <Badge value={vm.platform} type="platform" />}
                          {col.key === 'cluster' && <span className={cn(monoClass, "truncate max-w-[180px]")}>{vm.cluster}</span>}
                          {col.key === 'node' && <span className={cn(monoClass, "truncate max-w-[180px]")}>{vm.node}</span>}
                          {col.key === 'status' && <Badge value={vm.status} type="status" />}
                          {col.key === 'environment' && <Badge value={vm.environment} type="environment" />}
                          {col.key === 'criticality' && <Badge value={vm.criticality} type="criticality" />}
                          {col.key === 'os_family' && <Badge value={vm.os_family ?? 'unknown'} type="os_family" />}
                          {col.key === 'owner' && <span className="truncate max-w-xs">{vm.owner ?? ''}</span>}
                          {col.key === 'monitoring_enabled' && <span>{vm.monitoring_enabled ? 'Enabled' : 'Disabled'}</span>}
                          {col.key === 'pmp_enabled' && <span>{vm.pmp_enabled ? 'Enabled' : 'Disabled'}</span>}
                          {col.key === 'health' && <span className={monoClass}>{vm.health_score}</span>}
                          {col.key === 'resources' && (
                            <span className={cn(monoClass, "truncate max-w-[200px]")}>{vm.cpu_cores} vCPU · {formatMemory(vm.memory_mb)}</span>
                          )}
                          {col.key === 'fqdn' && <span className={cn(monoClass, "truncate max-w-xs")}>{vm.fqdn ?? ''}</span>}
                          {col.key === 'private_ip' && <span className={monoClass}>{vm.networks?.find((n) => n.role === 'private')?.ip_address ?? '—'}</span>}
                          {col.key === 'public_ip' && <span className={monoClass}>{vm.networks?.find((n) => n.role === 'public')?.ip_address ?? '—'}</span>}
                          {col.key === 'backup_ip' && <span className={monoClass}>{vm.networks?.find((n) => n.role === 'backup')?.ip_address ?? '—'}</span>}
                          {col.key === 'tags' && Boolean(vm.tags?.length) && (
                            <span className="inline-flex items-center gap-1 flex-wrap">
                              {vm.tags.slice(0, 3).map((t) => (
                                <span key={t} className="inline-flex items-center rounded bg-[var(--color-surface-tertiary)] px-1.5 py-0.5 text-xs text-[var(--color-text-tertiary)]">{t}</span>
                              ))}
                              {vm.tags.length > 3 && <span className="text-xs text-[var(--color-text-tertiary)]">+{vm.tags.length - 3}</span>}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
