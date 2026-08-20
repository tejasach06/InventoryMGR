'use client';

import { DragEvent, FormEvent, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { imports as importsApi } from '../api/imports';
import { detailMessage } from '../api/core';
import type { ImportAction, ImportBatch } from '../api/types';
import { Alert, Badge, BadgeTone, EmptyState, PageHeader, PageTransition, Spinner, cardClass, helpTextClass, primaryButtonClass, secondaryButtonClass, statTileClass, tableBodyClass, tableCellClass, tableClass, tableHeadClass, tableRowClass, tableWrapClass, monoClass } from '../components/ui';
import { cn } from '../lib/classNames';

const actions: ImportAction[] = ['create', 'update', 'unchanged', 'conflict', 'invalid', 'decommission'];
const actionTone: Record<ImportAction, BadgeTone> = {
  create: { type: 'status', value: 'running' },
  update: { type: 'status', value: 'unknown' },
  unchanged: { type: 'neutral' },
  conflict: { type: 'criticality', value: 'high' },
  invalid: { type: 'criticality', value: 'critical' },
  decommission: { type: 'status', value: 'decommissioned' },
};

export interface PreviewSummary {
  create: number;
  update: number;
  unchanged: number;
  conflict: number;
  invalid: number;
  decommission: number;
}

export function summarizePreview(batch: Pick<ImportBatch, 'summary' | 'rows'> | null | undefined): PreviewSummary {
  const counts: PreviewSummary = { create: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0, decommission: 0 };
  if (!batch) return counts;
  for (const action of actions) {
    const value = batch.summary?.[action];
    counts[action] = typeof value === 'number' ? value : batch.rows.filter((row) => row.action === action).length;
  }
  return counts;
}

const IP_ROLE_HEADERS = ['private_ip', 'public_ip', 'backup_ip'] as const;

function ImportRow({ row }: { row: ImportBatch['rows'][number] }) {
  const isDecommission = row.action === 'decommission';
  return (
    <tr className={tableRowClass}>
      <th className={cn('whitespace-nowrap px-4 py-3 text-left font-semibold text-[var(--color-text-primary)]', monoClass, 'tabular-nums')} scope="row">
        {isDecommission ? '—' : row.row_number}
      </th>
      <td className="whitespace-nowrap px-4 py-3">
        <Badge value={row.action} tone={actionTone[row.action]} />
        {row.action === 'update' && Object.keys(row.changes ?? {}).length > 0 ? (
          <span className={cn('ml-2 text-xs text-[var(--color-text-tertiary)]', monoClass, 'tabular-nums')}>
            {Object.keys(row.changes).length} fields
          </span>
        ) : null}
      </td>
      <td className={tableCellClass}>{row.normalized?.name ?? String(row.raw.name ?? '—')}</td>
      <td className={tableCellClass}>{row.normalized?.platform ?? String(row.raw.platform ?? '—')}</td>
      <td className={tableCellClass}>{row.normalized?.cluster ?? String(row.raw.cluster ?? '—')}</td>
      <td className={tableCellClass}>{String(row.raw.disks || '—')}</td>
      <td className={cn(tableCellClass, monoClass)}>{IP_ROLE_HEADERS.map((header) => row.raw[header]).filter(Boolean).join(', ') || '—'}</td>
      <td className="min-w-72 px-4 py-3 text-[var(--color-text-secondary)]">
        {row.errors.length > 0 || row.warnings.length > 0 ? (
          <>
            {row.errors.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-[var(--color-criticality-critical)]">{row.errors.map((error) => <li key={`${error.field}:${error.message}`}>{error.field}: {error.message}</li>)}</ul> : null}
            {row.warnings.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-[var(--color-status-warning)]">{row.warnings.map((warning) => <li key={`${warning.field}:${warning.message}`}>{warning.field}: {warning.message}</li>)}</ul> : null}
          </>
        ) : '—'}
      </td>
    </tr>
  );
}

export function ImportCsvPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmDecommission, setConfirmDecommission] = useState(false);
  const [commitResult, setCommitResult] = useState<{ created: number; updated: number; decommissioned: number } | null>(null);

  const preview = useMutation({
    mutationFn: (fullInventory: boolean) => {
      if (!file) throw new Error('Choose a CSV file before previewing.');
      return importsApi.previewImport(file, fullInventory);
    },
    onMutate: () => {
      setBatch(null);
      setConfirmDecommission(false);
      setCommitResult(null);
      commit.reset();
    },
    onSuccess: (result) => {
      setBatch(result);
      setConfirmDecommission(false);
      setCommitResult(null);
    },
  });

  const commit = useMutation({
    mutationFn: () => importsApi.commitImport(batch?.id ?? '', confirmDecommission),
    onSuccess: (result) => {
      setCommitResult(result);
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      if (batch) setBatch({ ...batch, status: 'committed', committed_at: new Date().toISOString() });
    },
  });

  const summary = summarizePreview(batch);
  const hasBlockingRows = summary.conflict > 0 || summary.invalid > 0;
  const candidateTotal = Number(batch?.summary?.decommission_candidate_total ?? 0);
  const isMajorDecommission = summary.decommission > 0 && candidateTotal > 0 && summary.decommission * 2 > candidateTotal;
  const cannotCommit = commit.isPending || hasBlockingRows || batch?.status === 'committed' || (isMajorDecommission && !confirmDecommission);
  const blockingReasonId = hasBlockingRows ? 'import-blocking-reason' : undefined;

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);
    setBatch(null);
    setConfirmDecommission(false);
    setCommitResult(null);
    preview.reset();
    commit.reset();
  }

  function clearFile(event: React.MouseEvent) {
    event.stopPropagation();
    if (fileInputRef.current) fileInputRef.current.value = '';
    handleFileChange(null);
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
    preview.mutate(false);
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
        <PageHeader title="Import" context="Operations" description="Validate every row before committing inventory changes." />
        <form className={cardClass + ' mb-6 grid gap-4'} onSubmit={submit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]" htmlFor="csv-file">CSV file</label>
            <div
              data-testid="dropzone"
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${dragging ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <label htmlFor="csv-file" className="flex cursor-pointer flex-col items-center justify-center w-full">
                {file ? (
                  <svg className="mb-3 h-8 w-8 text-[var(--color-text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
                    <path d="M14 3v5h5" />
                  </svg>
                ) : (
                  <svg className="mb-3 h-8 w-8 text-[var(--color-text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V4m0 0l-4 4m4-4 4 4" /><path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
                  </svg>
                )}
                {file ? (
                  <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                    {file.name}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-[var(--color-text-secondary)]">Drag and drop or click to upload</span>
                )}
              </label>
              {file ? (
                <button
                  type="button"
                  onClick={clearFile}
                  className="mt-2 flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                  aria-label="Clear selected file"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                  Clear selected file
                </button>
              ) : null}
              <input ref={fileInputRef} className="sr-only" id="csv-file" name="file" type="file" accept=".csv,text/csv" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} aria-describedby="csv-help" />
            </div>
            <p id="csv-help" className={helpTextClass}>
              Required headers: name, platform, cluster. Maximum 5 MiB and 5000 rows.
            </p>
            <details className="mt-2 text-sm text-[var(--color-text-tertiary)]">
              <summary className="cursor-pointer font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                CSV format reference
              </summary>
              <p className="mt-2 leading-relaxed">
                The downloadable template carries every importable column, ordered by
                group — identity, placement, classification, capacity, OS, network,
                ownership, operations, compliance dates, notes — and two SAMPLE- rows you
                should delete once you have copied the formats. Blank cells are left
                unchanged on existing VMs and take default values on new ones — importing
                never clears a field. Include external_id (VM-ID) and sr_id (SR-ID) columns
                to import those identifiers; when external_id is present it is what matches
                a row to an existing VM instead of the name. List several disks as
                name:size pairs (os:100;data:500) and several IPs in private_ip,
                public_ip or backup_ip, separated by semicolons. Importing only ever adds
                disks and IPs; removing one, or resizing a disk, is done in the VM form.
              </p>
            </details>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={primaryButtonClass}
                type="button"
                onClick={() => preview.mutate(false)}
                disabled={preview.isPending || !file}
              >
                {preview.isPending ? <><Spinner /> Uploading…</> : 'Preview partial import'}
              </button>
              <button
                className={secondaryButtonClass}
                type="button"
                onClick={() => preview.mutate(true)}
                disabled={preview.isPending || !file}
              >
                {preview.isPending ? <><Spinner /> Uploading…</> : 'Preview full inventory import'}
              </button>
              <button className={secondaryButtonClass} type="button" onClick={downloadTemplate}>
                Download template
              </button>
            </div>
            <p className={helpTextClass}>
              Marks every VM missing from this file as decommissioned.
            </p>
          </div>
        </form>
        {preview.isError ? <Alert>{detailMessage(preview.error)}</Alert> : null}
        {commit.isError ? <Alert>{detailMessage(commit.error)}</Alert> : null}
        {commit.isSuccess ? (
          <Alert tone="success">
            {commitResult?.decommissioned
              ? `Import committed. Inventory updated: ${commitResult.created} created, ${commitResult.updated} updated, ${commitResult.decommissioned} decommissioned.`
              : 'Import committed. Inventory has been updated from persisted preview rows.'}
          </Alert>
        ) : null}
        {batch && batch.ignored_columns?.length > 0 ? (
          <Alert tone="info">
            {batch.ignored_columns.length} columns ignored: {batch.ignored_columns.join(', ')}.
            Check for a misspelled header if you expected one of these to import.
          </Alert>
        ) : null}
        {batch && batch.full_inventory && summary.decommission > 0 ? (
          <Alert tone="info">
            Full inventory import: {summary.decommission} VMs missing from this file will be marked as decommissioned.
          </Alert>
        ) : null}
        {batch ? (
          <div className={cardClass + ' space-y-5' + (batch.status === 'committed' ? ' opacity-75' : '')}>
            <div className="grid gap-4 sm:flex sm:items-start sm:justify-between">
              <div>
                <p className={cn('text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]', monoClass)}>Batch {batch.id}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">{batch.filename}</h2>
              </div>
              <div className="flex flex-col items-end gap-2">
                {isMajorDecommission && batch.status !== 'committed' ? (
                  <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-status-warning)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmDecommission}
                      onChange={(e) => setConfirmDecommission(e.target.checked)}
                      className="rounded border-[var(--color-border)]"
                    />
                    I confirm decommissioning more than half the inventory
                  </label>
                ) : null}
                <button
                  className={primaryButtonClass}
                  type="button"
                  onClick={() => commit.mutate()}
                  disabled={cannotCommit}
                  aria-describedby={blockingReasonId}
                >
                  {commit.isPending ? <><Spinner /> Committing…</> : batch.status === 'committed' ? 'Committed' : 'Commit persisted batch'}
                </button>
              </div>
            </div>
            {hasBlockingRows ? <Alert><span id="import-blocking-reason">Commit disabled: {summary.conflict} conflict rows and {summary.invalid} invalid rows. Resolve the CSV and preview again before commit.</span></Alert> : null}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Preview summary">
              {actions.map((action) => (
                <div key={action} data-testid={`summary-${action}`} className={statTileClass}>
                  <Badge value={action} tone={actionTone[action]} />
                  <strong className={cn('mt-1 block text-2xl font-semibold text-[var(--color-text-primary)]', monoClass, 'tabular-nums')}>{summary[action]}</strong>
                </div>
              ))}
            </div>
            {Object.keys(batch.field_changes ?? {}).length > 0 ? (
              <div className="rounded-lg border border-[var(--color-border)] p-4">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  This import will change:
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                  {Object.entries(batch.field_changes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([field, count]) => (
                      <li key={field}>
                        <span className="font-medium text-[var(--color-text-primary)]">{field}</span>
                        {` on ${count} VMs`}
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
                      <th className="px-4 py-3" scope="col">Disks</th>
                      <th className="px-4 py-3" scope="col">IPs</th>
                      <th className="px-4 py-3" scope="col">Messages</th>
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
