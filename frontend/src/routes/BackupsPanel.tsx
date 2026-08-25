'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backups as backupsApi } from '../api/backups';
import { detailMessage } from '../api/core';
import type { BackupFile, BackupSettings } from '../api/types';
import {
  Alert,
  ConfirmDialog,
  RemoveButton,
  Skeleton,
  Spinner,
  dangerButtonClass,
  helpTextClass,
  inputClass,
  labelClass,
  monoClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionTitleClass,
  selectClass,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadClass,
  tableRowClass,
  tableWrapClass,
} from '../components/ui';
import { cn } from '../lib/classNames';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  const formatted = val % 1 === 0 ? String(val) : val.toFixed(1);
  return `${formatted} ${sizes[i]}`;
}
function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

export function BackupsPanel() {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: ['backups', 'overview'],
    queryFn: backupsApi.overview,
  });

  const [settingsForm, setSettingsForm] = useState<BackupSettings>({
    enabled: false,
    hour_utc: 2,
    retention: 7,
  });

  const [deleteTarget, setDeleteTarget] = useState<BackupFile | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [restoreSuccessMsg, setRestoreSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (overviewQuery.data?.settings) {
      setSettingsForm(overviewQuery.data.settings);
    }
  }, [overviewQuery.data]);
  const saveSettingsMutation = useMutation({
    mutationFn: (patch: { enabled?: boolean; hour_utc?: number; retention?: number }) =>
      backupsApi.updateSettings(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', 'overview'] });
    },
  });

  const createBackupMutation = useMutation({
    mutationFn: () => backupsApi.create(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', 'overview'] });
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: (name: string) => backupsApi.remove(name),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['backups', 'overview'] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (file: File) => backupsApi.restore(file),
    onSuccess: () => {
      setShowRestoreDialog(false);
      setRestoreSuccessMsg('Database restored successfully. Redirecting to login...');
      setTimeout(() => {
        window.location.assign('/login');
      }, 1500);
    },
  });

  const handleSaveSettings = (e: FormEvent) => {
    e.preventDefault();
    saveSettingsMutation.mutate({
      enabled: settingsForm.enabled,
      hour_utc: Number(settingsForm.hour_utc),
      retention: Number(settingsForm.retention),
    });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setRestoreFile(e.target.files[0]);
    } else {
      setRestoreFile(null);
    }
  };

  if (overviewQuery.isLoading) {
    return (
      <div role="tabpanel" id="panel-backups" aria-labelledby="tab-backups" className="animate-fade-in space-y-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (overviewQuery.isError) {
    return (
      <div role="tabpanel" id="panel-backups" aria-labelledby="tab-backups" className="animate-fade-in">
        <Alert tone="error">
          {detailMessage(overviewQuery.error)}
        </Alert>
      </div>
    );
  }

  const data = overviewQuery.data!;

  return (
    <div role="tabpanel" id="panel-backups" aria-labelledby="tab-backups" className="animate-fade-in space-y-8">
      {/* Schedule Configuration */}
      <section>
        <h3 className={sectionTitleClass}>Backup Schedule</h3>
        <p className={helpTextClass}>Configure automated nightly database dumps and retention limit.</p>
        <form onSubmit={handleSaveSettings} className="mt-4 space-y-4 max-w-xl">
          <label className="flex items-center gap-2.5 text-sm text-[var(--color-text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={settingsForm.enabled}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            <span>Enable automated nightly backups</span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="backup-hour" className={labelClass}>
                Run Hour (UTC)
              </label>
              <select
                id="backup-hour"
                value={settingsForm.hour_utc}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, hour_utc: Number(e.target.value) }))}
                className={selectClass}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00 UTC
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="backup-retention" className={labelClass}>
                Retention (dumps kept)
              </label>
              <input
                id="backup-retention"
                type="number"
                min={1}
                max={365}
                value={settingsForm.retention}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, retention: Number(e.target.value) }))}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className={primaryButtonClass}
              disabled={saveSettingsMutation.isPending || settingsForm.retention < 1 || settingsForm.retention > 365}
            >
              {saveSettingsMutation.isPending ? <Spinner /> : null}
              Save Schedule
            </button>
            {saveSettingsMutation.isSuccess ? (
              <span className="text-sm text-[var(--color-text-secondary)]">Saved</span>
            ) : null}
            {saveSettingsMutation.isError ? (
              <span className="text-sm font-medium text-[var(--color-criticality-critical)]" role="alert">
                {detailMessage(saveSettingsMutation.error)}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      {/* Manual Backup & Available Backups */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className={sectionTitleClass}>Available Backups</h3>
            <p className={helpTextClass}>Downloadable custom-format PostgreSQL dumps stored on server.</p>
          </div>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
          >
            {createBackupMutation.isPending ? <Spinner /> : null}
            {createBackupMutation.isPending ? 'Backing up…' : 'Back up now'}
          </button>
        </div>

        {createBackupMutation.isError ? (
          <Alert tone="error">
            {detailMessage(createBackupMutation.error)}
          </Alert>
        ) : null}

        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={tableCellClass}>Filename</th>
                <th className={tableCellClass}>Size</th>
                <th className={tableCellClass}>Created</th>
                <th className={cn(tableCellClass, 'text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {data.backups.length === 0 ? (
                <tr className={tableRowClass}>
                  <td colSpan={4} className={cn(tableCellClass, 'text-center text-[var(--color-text-tertiary)] py-8')}>
                    No backups yet.
                  </td>
                </tr>
              ) : (
                data.backups.map((b) => (
                  <tr key={b.name} className={tableRowClass}>
                    <td className={cn(tableCellClass, monoClass, 'font-medium')}>{b.name}</td>
                    <td className={cn(tableCellClass, monoClass, 'tabular-nums')}>{formatBytes(b.size_bytes)}</td>
                    <td className={cn(tableCellClass, 'text-[var(--color-text-secondary)]')}>{formatDate(b.created_at)}</td>
                    <td className={cn(tableCellClass, 'text-right')}>
                      <div className="inline-flex items-center gap-2">
                        <a
                          href={backupsApi.downloadUrl(b.name)}
                          download={b.name}
                          className={secondaryButtonClass}
                        >
                          Download
                        </a>
                        <RemoveButton
                          label={`Delete backup ${b.name}`}
                          onClick={() => setDeleteTarget(b)}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent Jobs */}
      <section className="space-y-4">
        <h3 className={sectionTitleClass}>Recent Backup & Restore Activity</h3>
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={tableCellClass}>Kind</th>
                <th className={tableCellClass}>Status</th>
                <th className={tableCellClass}>Filename</th>
                <th className={tableCellClass}>Started</th>
                <th className={tableCellClass}>Error</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {data.jobs.length === 0 ? (
                <tr className={tableRowClass}>
                  <td colSpan={5} className={cn(tableCellClass, 'text-center text-[var(--color-text-tertiary)] py-6')}>
                    No recent activity.
                  </td>
                </tr>
              ) : (
                data.jobs.map((job) => (
                  <tr key={job.id} className={tableRowClass}>
                    <td className={cn(tableCellClass, 'capitalize')}>{job.kind.replace('_', ' ')}</td>
                    <td className={cn(tableCellClass, monoClass)}>{job.status}</td>
                    <td className={cn(tableCellClass, monoClass, 'text-xs text-[var(--color-text-secondary)]')}>
                      {job.filename ?? '—'}
                    </td>
                    <td className={cn(tableCellClass, 'text-[var(--color-text-secondary)]')}>
                      {formatDate(job.started_at)}
                    </td>
                    <td className={cn(tableCellClass, 'text-xs text-[var(--color-criticality-critical)] max-w-xs truncate')}>
                      {job.error ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Restore Section */}
      <section className="border-t border-[var(--color-border-subtle)] pt-6 space-y-4">
        <h3 className={sectionTitleClass}>Restore Database</h3>
        <p className="text-sm text-[var(--color-criticality-critical)]">
          Warning: Restoring from a backup replaces all current inventory records and invalidates all active user sessions. An automatic pre-restore backup will be created before applying changes.
        </p>

        {restoreSuccessMsg ? (
          <Alert tone="info">
            {restoreSuccessMsg}
          </Alert>
        ) : null}

        {restoreMutation.isError ? (
          <Alert tone="error">
            {detailMessage(restoreMutation.error)}
          </Alert>
        ) : null}

        <div className="space-y-4 max-w-xl">
          <div>
            <label htmlFor="restore-file" className={labelClass}>
              Backup Archive (.dump)
            </label>
            <input
              id="restore-file"
              type="file"
              accept=".dump"
              onChange={handleFileChange}
              className={cn(inputClass, 'file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[var(--color-surface-tertiary)] file:text-[var(--color-text-primary)] hover:file:bg-[var(--color-surface-secondary)]')}
            />
          </div>

          <div>
            <label htmlFor="restore-confirm" className={labelClass}>
              Type <span className="font-bold text-[var(--color-text-primary)]">RESTORE</span> to confirm
            </label>
            <input
              id="restore-confirm"
              type="text"
              value={restoreConfirmText}
              onChange={(e) => setRestoreConfirmText(e.target.value)}
              placeholder="RESTORE"
              className={inputClass}
            />
          </div>

          <div>
            <button
              type="button"
              className={dangerButtonClass}
              disabled={!restoreFile || restoreConfirmText !== 'RESTORE' || restoreMutation.isPending}
              onClick={() => setShowRestoreDialog(true)}
            >
              {restoreMutation.isPending ? <Spinner /> : null}
              {restoreMutation.isPending ? 'Restoring…' : 'Restore Database'}
            </button>
          </div>
        </div>
      </section>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Backup"
        body={`Are you sure you want to delete backup file "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        pending={deleteBackupMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteBackupMutation.mutate(deleteTarget.name);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Restore Confirmation Dialog */}
      <ConfirmDialog
        open={showRestoreDialog}
        title="Confirm Destructive Database Restore"
        body={`Are you sure you want to restore "${restoreFile?.name}"? All current data will be overwritten and all users will be signed out.`}
        confirmLabel="Restore Now"
        tone="danger"
        pending={restoreMutation.isPending}
        onConfirm={() => {
          if (restoreFile) restoreMutation.mutate(restoreFile);
        }}
        onCancel={() => setShowRestoreDialog(false)}
      />
    </div>
  );
}
