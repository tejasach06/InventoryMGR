'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vms as vmsApi } from '../api/vms';
import { detailMessage } from '../api/core';
import { Alert, Drawer, inputClass, primaryButtonClass, secondaryButtonClass } from './ui';
import { FilterDrawer } from './filters/FilterDrawer';
import {
  COMMON_COLUMNS, EXPORT_COLUMNS, EXPORT_GROUPS, exportColumnLabel, exportParams, loadPresets, savePresets,
  type DiskLayout, type ExportFormat, type ExportOptions, type ExportPreset, type ExportScope,
} from '../lib/exportOptions';
import { humanize, type Filters } from '../lib/inventoryFilters';

function filterSummary(filters: Filters): string {
  const parts = (Object.keys(filters) as (keyof Filters)[])
    .filter((name) => filters[name].length > 0)
    .map((name) => `${humanize(name)}: ${filters[name].join(', ')}`);
  return parts.length ? parts.join(' · ') : 'No filters (all VMs)';
}

type ExportDrawerProps = {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  selectedIds: string[];
  initialColumns: string[];
};

// Mounted only while open, so every open re-seeds from the page.
export function ExportDrawer(props: ExportDrawerProps) {
  return props.open ? <ExportDrawerBody {...props} /> : null;
}

function ExportDrawerBody({ onClose, filters: initialFilters, selectedIds, initialColumns }: ExportDrawerProps) {
  const [scope, setScope] = useState<ExportScope>(selectedIds.length > 0 ? 'selected' : 'filtered');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [columns, setColumns] = useState<string[]>(initialColumns);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [diskLayout, setDiskLayout] = useState<DiskLayout>('joined');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presets, setPresets] = useState<ExportPreset[]>(loadPresets);
  const [presetName, setPresetName] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const options: ExportOptions = { scope, ids: selectedIds, filters, columns, format, diskLayout };
  const previewParams = exportParams(options, 'json');
  const preview = useQuery({
    queryKey: ['vm-export-preview', previewParams.toString()],
    queryFn: () => vmsApi.exportPreview(previewParams),
    enabled: columns.length > 0 && (scope !== 'selected' || selectedIds.length > 0),
  });

  function toggle(key: string) {
    setColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  function move(index: number, delta: number) {
    setColumns((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function applyPreset(name: string) {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    setColumns(preset.columns.filter((c) => EXPORT_COLUMNS.includes(c)));
    setFormat(preset.format);
    setDiskLayout(preset.diskLayout);
    setFilters(preset.filters);
  }
  function persist(next: ExportPreset[]) {
    savePresets(next);
    setPresets(next);
  }
  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    persist([...presets.filter((p) => p.name !== name), { name, columns, format, diskLayout, filters }]);
    setPresetName('');
  }
  async function download() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const response = await fetch(vmsApi.exportUrl(exportParams(options)), { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const detail = typeof body?.detail === 'string' ? body.detail : null;
        throw new Error(detail ?? `Export failed (HTTP ${response.status}).`);
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `vms.${format === 'csv' ? 'csv' : 'xlsx'}`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setDownloading(false);
    }
  }

  const canDownload = columns.length > 0 && (scope !== 'selected' || selectedIds.length > 0);
  const scopes: [ExportScope, string][] = [
    ...(selectedIds.length > 0 ? [['selected', `Only the ${selectedIds.length} VM${selectedIds.length === 1 ? '' : 's'} I ticked`] as [ExportScope, string]] : []),
    ['filtered', 'Everything in the current list (filters applied)'],
    ['all', 'Every VM, ignoring filters'],
  ];

  return (
    <>
      <Drawer
        open
        fullscreen
        onClose={onClose}
        title="Export VMs"
        footer={
          <>
            <button type="button" className={secondaryButtonClass} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryButtonClass} disabled={!canDownload || downloading} onClick={download}>
              {downloading ? 'Preparing…' : `Download ${format === 'csv' ? 'CSV' : 'Excel'}`}
            </button>
          </>
        }
      >
        {downloadError ? <Alert>{downloadError}</Alert> : null}
        <div className="grid gap-6 text-sm lg:h-full lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:overflow-hidden">
          <div className="grid content-start gap-6 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          <section aria-label="Presets" className="grid gap-2">
            <h3 className="font-semibold">Presets</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Load preset" className={inputClass} value="" onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Load preset…</option>
                {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <input aria-label="Preset name" className={inputClass} placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <button type="button" className={secondaryButtonClass} disabled={!presetName.trim()} onClick={savePreset}>Save preset</button>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">Presets are saved in this browser only.</p>
            {presets.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <li key={p.name} className="flex items-center gap-1 rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1">
                    {p.name}
                    <button type="button" aria-label={`Delete preset ${p.name}`} onClick={() => persist(presets.filter((x) => x.name !== p.name))}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">Rows</legend>
            {scopes.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="export-scope" checked={scope === value} onChange={() => setScope(value)} />
                {label}
              </label>
            ))}
            {scope === 'filtered' && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--color-surface-tertiary)] p-2">
                <span>{filterSummary(filters)}</span>
                <button type="button" className={secondaryButtonClass} onClick={() => setFiltersOpen(true)}>Edit filters</button>
              </div>
            )}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">Columns ({columns.length})</legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setColumns(COMMON_COLUMNS)}>Common</button>
              <button type="button" className={secondaryButtonClass} onClick={() => setColumns([...EXPORT_COLUMNS])}>Everything</button>
              <button type="button" className={secondaryButtonClass} onClick={() => setColumns(initialColumns)}>As in the list</button>
              <button type="button" className={secondaryButtonClass} onClick={() => setColumns([])}>Clear</button>
            </div>
            {EXPORT_GROUPS.map((group) => (
              <div key={group.title} className="grid gap-1">
                <h4 className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">{group.title}</h4>
                <div className="grid grid-cols-2 gap-1 xl:grid-cols-3">
                  {group.columns.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input type="checkbox" checked={columns.includes(key)} onChange={() => toggle(key)} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">Format</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2"><input type="radio" name="export-format" checked={format === 'csv'} onChange={() => setFormat('csv')} />CSV</label>
              <label className="flex items-center gap-2"><input type="radio" name="export-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} />Excel</label>
            </div>
          </fieldset>

          {columns.includes('disks') && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-semibold">Disks</legend>
              <label className="flex items-center gap-2"><input type="radio" name="export-disks" checked={diskLayout === 'joined'} onChange={() => setDiskLayout('joined')} />One cell per VM (joined)</label>
              <label className="flex items-center gap-2"><input type="radio" name="export-disks" checked={diskLayout === 'rows'} onChange={() => setDiskLayout('rows')} />One row per disk (VM fields repeated)</label>
            </fieldset>
          )}

          </div>

          <section aria-label="Preview" className="grid min-w-0 content-start gap-2 lg:min-h-0 lg:overflow-y-auto">
            {columns.length > 0 && <h3 className="font-semibold">Column order <span className="text-xs font-normal text-[var(--color-text-tertiary)]">— use ↑ ↓ to rearrange</span></h3>}
            {columns.length > 0 && (
              <ol aria-label="Column order" className="grid gap-1">
                {columns.map((key, i) => (
                  <li key={key} className="flex items-center justify-between rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1">
                    <span>{i + 1}. {exportColumnLabel(key)}</span>
                    <span className="flex gap-1">
                      <button type="button" aria-label={`Move ${exportColumnLabel(key)} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" aria-label={`Move ${exportColumnLabel(key)} down`} disabled={i === columns.length - 1} onClick={() => move(i, 1)}>↓</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <h3 className="font-semibold">Preview{preview.data ? ` — ${preview.data.total} VM${preview.data.total === 1 ? '' : 's'}` : ''}</h3>
            {preview.isError ? <Alert>{detailMessage(preview.error)}</Alert> : null}
            {preview.data && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead><tr>{preview.data.columns.map((c) => <th key={c} className="px-2 py-1">{exportColumnLabel(c)}</th>)}</tr></thead>
                  <tbody>
                    {preview.data.rows.map((row, i) => (
                      <tr key={i}>{row.map((cell, j) => <td key={j} className="max-w-48 truncate px-2 py-1">{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </Drawer>
      <FilterDrawer open={filtersOpen} filters={filters} onClose={() => setFiltersOpen(false)} onApply={(f) => { setFilters(f); setFiltersOpen(false); }} />
    </>
  );
}
