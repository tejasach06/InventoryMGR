'use client';

import { DragEvent, FormEvent, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ImportAction, ImportBatch } from '../api/client';
import { Alert, Badge, EmptyState, PageHeader, PageTransition, Spinner, cardClass, helpTextClass, primaryButtonClass, secondaryButtonClass, tableBodyClass, tableCellClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';

const actions: ImportAction[] = ['create', 'update', 'unchanged', 'conflict', 'invalid'];

const actionBorderColor: Record<ImportAction, string> = {
  create: 'border-l-emerald-500',
  update: 'border-l-blue-500',
  unchanged: 'border-l-slate-400',
  conflict: 'border-l-amber-500',
  invalid: 'border-l-red-500',
};

export interface PreviewSummary {
  create: number;
  update: number;
  unchanged: number;
  conflict: number;
  invalid: number;
}

export function summarizePreview(batch: Pick<ImportBatch, 'summary' | 'rows'> | null | undefined): PreviewSummary {
  const counts: PreviewSummary = { create: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0 };
  if (!batch) return counts;
  for (const action of actions) {
    const value = batch.summary?.[action];
    counts[action] = typeof value === 'number' ? value : batch.rows.filter((row) => row.action === action).length;
  }
  return counts;
}

function ImportRow({ row }: { row: ImportBatch['rows'][number] }) {
  return (
    <tr className={tableRowClass}>
      <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-100" scope="row">{row.row_number}</th>
      <td className="whitespace-nowrap px-4 py-3">
        <Badge value={row.action} />
        {row.action === 'update' && Object.keys(row.changes ?? {}).length > 0 ? (
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
            {Object.keys(row.changes).length} fields
          </span>
        ) : null}
      </td>
      <td className={tableCellClass}>{row.normalized?.name ?? String(row.raw.name ?? '—')}</td>
      <td className={tableCellClass}>{row.normalized?.platform ?? String(row.raw.platform ?? '—')}</td>
      <td className={tableCellClass}>{row.normalized?.cluster ?? String(row.raw.cluster ?? '—')}</td>
      <td className={tableCellClass}>{row.raw.disk_name ? `${row.raw.disk_name}${row.raw.disk_gb ? ` (${row.raw.disk_gb} GB)` : ''}` : '—'}</td>
      <td className={tableCellClass}>{String(row.raw.ip_address ?? '—')}</td>
      <td className="min-w-72 px-4 py-3 text-slate-700 dark:text-slate-300">{row.errors.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-red-700 dark:text-red-300">{row.errors.map((error) => <li key={`${error.field}:${error.message}`}>{error.field}: {error.message}</li>)}</ul> : '—'}</td>
    </tr>
  );
}

export function ImportCsvPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [dragging, setDragging] = useState(false);
  const preview = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a CSV file before previewing.');
      return api.previewImport(file);
    },
    onMutate: () => {
      setBatch(null);
      commit.reset();
    },
    onSuccess: (result) => setBatch(result),
  });
  const commit = useMutation({
    mutationFn: () => api.commitImport(batch?.id ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      if (batch) setBatch({ ...batch, status: 'committed', committed_at: new Date().toISOString() });
    },
  });
  const summary = summarizePreview(batch);
  const hasBlockingRows = summary.conflict > 0 || summary.invalid > 0;
  const blockingReasonId = hasBlockingRows ? 'import-blocking-reason' : undefined;

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);
    setBatch(null);
    preview.reset();
    commit.reset();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      handleFileChange(droppedFile);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    preview.mutate();
  }

  function downloadTemplate() {
    const anchor = document.createElement('a');
    anchor.href = '/api/imports/template';
    anchor.download = 'vm-import-template.csv';
    anchor.click();
  }

  return (
    <PageTransition>
      <section className="mx-auto w-full max-w-4xl">
        <PageHeader title="Import" eyebrow="Preview before upsert" />
        <form className={cardClass + ' mb-6 grid gap-4'} onSubmit={submit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="csv-file">CSV file</label>
            <div
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${dragging ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10' : 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600'}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              aria-label="Upload CSV file"
            >
              <svg className="mb-3 h-8 w-8 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4m0 0l-4 4m4-4 4 4" /><path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
              </svg>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {file ? file.name : 'Drag and drop or click to upload'}
              </span>
              <input ref={fileInputRef} className="sr-only" id="csv-file" name="file" type="file" accept=".csv,text/csv" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} aria-describedby="csv-help" />
            </div>
            <p id="csv-help" className={helpTextClass}>
              Required headers: name, platform, cluster. Maximum 5 MiB and 5000 rows.
              Blank cells are left unchanged on existing VMs and take default values on
              new ones — importing never clears a field. Multi-disk VMs are managed in
              the VM form.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className={primaryButtonClass} type="submit" disabled={preview.isPending || !file}>
              {preview.isPending ? <><Spinner /> Uploading…</> : 'Preview CSV'}
            </button>
            <button className={secondaryButtonClass} type="button" onClick={downloadTemplate}>
              Download template
            </button>
          </div>
        </form>
        {preview.isError ? <Alert>{detailMessage(preview.error)}</Alert> : null}
        {commit.isError ? <Alert>{detailMessage(commit.error)}</Alert> : null}
        {commit.isSuccess ? <Alert tone="success">Import committed. Inventory has been updated from persisted preview rows.</Alert> : null}
        {batch && batch.ignored_columns?.length > 0 ? (
          <Alert tone="info">
            {batch.ignored_columns.length} columns ignored: {batch.ignored_columns.join(', ')}.
            Check for a misspelled header if you expected one of these to import.
          </Alert>
        ) : null}
        {batch ? (
          <div className={cardClass + ' space-y-5' + (batch.status === 'committed' ? ' opacity-75' : '')}>
            <div className="grid gap-4 sm:flex sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Batch {batch.id}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{batch.filename}</h2>
              </div>
              <button className={primaryButtonClass} type="button" onClick={() => commit.mutate()} disabled={commit.isPending || hasBlockingRows || batch.status === 'committed'} aria-describedby={blockingReasonId}>
                {commit.isPending ? <><Spinner /> Committing…</> : batch.status === 'committed' ? 'Committed' : 'Commit persisted batch'}
              </button>
            </div>
            {hasBlockingRows ? <Alert><span id="import-blocking-reason">Commit disabled: {summary.conflict} conflict rows and {summary.invalid} invalid rows. Resolve the CSV and preview again before commit.</span></Alert> : null}
            <div className="grid gap-3 sm:grid-cols-5" aria-label="Preview summary">
              {actions.map((action) => (
                <div key={action} data-testid={`summary-${action}`} className={`summary-card rounded-xl border border-slate-200 border-l-4 ${actionBorderColor[action]} bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900`}>
                  <span className="text-sm font-medium capitalize text-slate-500 dark:text-slate-400">{action}</span>
                  <strong className="mt-1 block text-2xl font-semibold text-slate-950 dark:text-slate-100">{summary[action]}</strong>
                </div>
              ))}
            </div>
            {Object.keys(batch.field_changes ?? {}).length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  This import will change:
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                  {Object.entries(batch.field_changes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([field, count]) => (
                      <li key={field}>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{field}</span>
                        {' on '}
                        {count}
                        {' VMs'}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            {batch.rows.length === 0 ? <EmptyState title="No rows in preview" body="Upload a CSV with inventory rows to see create, update, conflict, and invalid actions." /> : (
              <div className={tableWrapClass}>
                <table className={tableClass}>
                  <thead className={tableHeadClass}>
                    <tr>
                      <th className="px-4 py-3" scope="col">Row</th>
                      <th className="px-4 py-3" scope="col">Action</th>
                      <th className="px-4 py-3" scope="col">Name</th>
                      <th className="px-4 py-3" scope="col">Platform</th>
                      <th className="px-4 py-3" scope="col">Cluster</th>
                      <th className="px-4 py-3" scope="col">Disk</th>
                      <th className="px-4 py-3" scope="col">IP</th>
                      <th className="px-4 py-3" scope="col">Errors</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {batch.rows.map((row) => <ImportRow key={row.id} row={row} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </PageTransition>
  );
}
