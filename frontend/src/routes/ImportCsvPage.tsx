'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ImportAction, ImportBatch } from '../api/client';
import { Alert, Badge, EmptyState, PageHeader, cardClass, helpTextClass, inputClass, labelClass, primaryButtonClass, tableBodyClass, tableCellClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass } from '../components/ui';

const actions: ImportAction[] = ['create', 'update', 'conflict', 'invalid'];

export interface PreviewSummary {
  create: number;
  update: number;
  conflict: number;
  invalid: number;
}

export function summarizePreview(batch: Pick<ImportBatch, 'summary' | 'rows'> | null | undefined): PreviewSummary {
  const counts: PreviewSummary = { create: 0, update: 0, conflict: 0, invalid: 0 };
  if (!batch) return counts;
  for (const action of actions) {
    const value = batch.summary?.[action];
    counts[action] = typeof value === 'number' ? value : batch.rows.filter((row) => row.action === action).length;
  }
  return counts;
}

export function ImportCsvPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    preview.mutate();
  }

  return (
    <section>
      <PageHeader title="CSV Import" eyebrow="Preview before upsert" />
      <form className={cardClass + ' mb-6 grid gap-4'} onSubmit={submit}>
        <div>
          <label className={labelClass} htmlFor="csv-file">CSV file</label>
          <input className={inputClass} id="csv-file" name="file" type="file" accept=".csv,text/csv" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} aria-describedby="csv-help" />
          <p id="csv-help" className={helpTextClass}>Required headers: name, platform, environment, cluster, host. Maximum 5 MiB and 5000 rows.</p>
        </div>
        <div><button className={primaryButtonClass} type="submit" disabled={preview.isPending || !file}>{preview.isPending ? 'Uploading…' : 'Preview CSV'}</button></div>
      </form>
      {preview.isError ? <Alert>{detailMessage(preview.error)}</Alert> : null}
      {commit.isError ? <Alert>{detailMessage(commit.error)}</Alert> : null}
      {commit.isSuccess ? <Alert tone="success">Import committed. Inventory has been updated from persisted preview rows.</Alert> : null}
      {batch ? (
        <div className={cardClass + ' space-y-5'}>
          <div className="grid gap-4 sm:flex sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Batch {batch.id}</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{batch.filename}</h2>
            </div>
            <button className={primaryButtonClass} type="button" onClick={() => commit.mutate()} disabled={commit.isPending || hasBlockingRows || batch.status === 'committed'} aria-describedby={blockingReasonId}>
              {commit.isPending ? 'Committing…' : batch.status === 'committed' ? 'Committed' : 'Commit persisted batch'}
            </button>
          </div>
          {hasBlockingRows ? <Alert><span id="import-blocking-reason">Commit disabled: {summary.conflict} conflict rows and {summary.invalid} invalid rows. Resolve the CSV and preview again before commit.</span></Alert> : null}
          <div className="grid gap-3 sm:grid-cols-4" aria-label="Preview summary">
            {actions.map((action) => <div key={action} className="summary-card rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900"><span className="text-sm font-medium capitalize text-slate-500 dark:text-slate-400">{action}</span><strong className="mt-1 block text-2xl font-semibold text-slate-950 dark:text-slate-100">{summary[action]}</strong></div>)}
          </div>
          {batch.rows.length === 0 ? <EmptyState title="No rows in preview" body="Upload a CSV with inventory rows to see create, update, conflict, and invalid actions." /> : (
            <div className={tableWrapClass}>
              <table className={tableClass}>
                <thead className={tableHeadClass}>
                  <tr>
                    <th className="px-4 py-3" scope="col">Row</th>
                    <th className="px-4 py-3" scope="col">Action</th>
                    <th className="px-4 py-3" scope="col">Name</th>
                    <th className="px-4 py-3" scope="col">Platform</th>
                    <th className="px-4 py-3" scope="col">Environment</th>
                    <th className="px-4 py-3" scope="col">Cluster</th>
                    <th className="px-4 py-3" scope="col">Host</th>
                    <th className="px-4 py-3" scope="col">Errors</th>
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>
                  {batch.rows.map((row) => (
                    <tr key={row.id} className={tableRowClass}>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-semibold text-slate-900 dark:text-slate-100" scope="row">{row.row_number}</th>
                      <td className="whitespace-nowrap px-4 py-3"><Badge value={row.action} /></td>
                      <td className={tableCellClass}>{row.normalized?.name ?? String(row.raw.name ?? '—')}</td>
                      <td className={tableCellClass}>{row.normalized?.platform ?? String(row.raw.platform ?? '—')}</td>
                      <td className={tableCellClass}>{row.normalized?.environment ?? String(row.raw.environment ?? '—')}</td>
                      <td className={tableCellClass}>{row.normalized?.cluster ?? String(row.raw.cluster ?? '—')}</td>
                      <td className={tableCellClass}>{row.normalized?.host ?? String(row.raw.host ?? '—')}</td>
                      <td className="min-w-72 px-4 py-3 text-slate-700 dark:text-slate-300">{row.errors.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-red-700 dark:text-red-300">{row.errors.map((error) => <li key={`${error.field}:${error.message}`}>{error.field}: {error.message}</li>)}</ul> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
