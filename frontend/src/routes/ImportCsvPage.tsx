import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ImportAction, ImportBatch } from '../api/client';
import { Alert, Badge, EmptyState, PageHeader } from '../components/ui';

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
      <form className="card upload-card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="csv-file">CSV file</label>
          <input id="csv-file" name="file" type="file" accept=".csv,text/csv" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} aria-describedby="csv-help" />
          <p id="csv-help" className="muted">Required headers: name, platform, environment, cluster, host. Maximum 5 MiB and 5000 rows.</p>
        </div>
        <button type="submit" disabled={preview.isPending || !file}>{preview.isPending ? 'Uploading…' : 'Preview CSV'}</button>
      </form>
      {preview.isError ? <Alert>{detailMessage(preview.error)}</Alert> : null}
      {commit.isError ? <Alert>{detailMessage(commit.error)}</Alert> : null}
      {commit.isSuccess ? <Alert tone="success">Import committed. Inventory has been updated from persisted preview rows.</Alert> : null}
      {batch ? (
        <div className="card preview-card">
          <div className="preview-header">
            <div>
              <p className="eyebrow">Batch {batch.id}</p>
              <h2>{batch.filename}</h2>
            </div>
            <button type="button" onClick={() => commit.mutate()} disabled={commit.isPending || hasBlockingRows || batch.status === 'committed'} aria-describedby={blockingReasonId}>
              {commit.isPending ? 'Committing…' : batch.status === 'committed' ? 'Committed' : 'Commit persisted batch'}
            </button>
          </div>
          {hasBlockingRows ? <Alert><span id="import-blocking-reason">Commit disabled: {summary.conflict} conflict rows and {summary.invalid} invalid rows. Resolve the CSV and preview again before commit.</span></Alert> : null}
          <div className="summary-grid" aria-label="Preview summary">
            {actions.map((action) => <div key={action} className="summary-card"><span>{action}</span><strong>{summary[action]}</strong></div>)}
          </div>
          {batch.rows.length === 0 ? <EmptyState title="No rows in preview" body="Upload a CSV with inventory rows to see create, update, conflict, and invalid actions." /> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Action</th>
                    <th scope="col">Name</th>
                    <th scope="col">Platform</th>
                    <th scope="col">Environment</th>
                    <th scope="col">Cluster</th>
                    <th scope="col">Host</th>
                    <th scope="col">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.row_number}</th>
                      <td><Badge value={row.action} /></td>
                      <td>{row.normalized?.name ?? String(row.raw.name ?? '—')}</td>
                      <td>{row.normalized?.platform ?? String(row.raw.platform ?? '—')}</td>
                      <td>{row.normalized?.environment ?? String(row.raw.environment ?? '—')}</td>
                      <td>{row.normalized?.cluster ?? String(row.raw.cluster ?? '—')}</td>
                      <td>{row.normalized?.host ?? String(row.raw.host ?? '—')}</td>
                      <td className="errors-cell">{row.errors.length > 0 ? <ul className="error-list">{row.errors.map((error) => <li key={`${error.field}:${error.message}`}>{error.field}: {error.message}</li>)}</ul> : '—'}</td>
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
