'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settings as settingsApi } from '../api/settings';
import { detailMessage } from '../api/core';
import { useAccent } from '../components/AccentProvider';
import { useCurrentUser } from '../components/AuthContext';
import { ThemeSegmented, useTheme } from '../components/ThemeProvider';
import { Alert, PageHeader, PageTransition, Spinner, cardClass, inputClass, primaryButtonClass } from '../components/ui';
import { ACCENT_PRESETS, AccentId } from '../lib/accentPresets';
import { cn } from '../lib/classNames';
import { UsersPanel } from './UsersPage';
import { LdapPanel } from './LdapSettingsPanel';

function AppearancePanel() {
  const queryClient = useQueryClient();
  const { accent, setAccent } = useAccent();
  const { resolvedTheme } = useTheme();
  const latestAccent = useRef(accent);
  const latestRequest = useRef(0);
  const swatches = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    latestAccent.current = accent;
  }, [accent]);
  const save = useMutation<{ accent: AccentId }, Error, AccentId>({
    mutationFn: (accent: AccentId) => settingsApi.setAccent(accent),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['preferences', 'accent'] }),
  });

  function selectAccent(nextAccent: AccentId) {
    const previousAccent = latestAccent.current;
    const request = ++latestRequest.current;
    latestAccent.current = nextAccent;
    setAccent(nextAccent);
    save.mutate(nextAccent, {
      onError: () => {
        if (request !== latestRequest.current) return;
        latestAccent.current = previousAccent;
        setAccent(previousAccent);
      },
    });
  }

  function selectAdjacentAccent(index: number, direction: 1 | -1) {
    const nextIndex = (index + direction + ACCENT_PRESETS.length) % ACCENT_PRESETS.length;
    selectAccent(ACCENT_PRESETS[nextIndex].id);
    swatches.current[nextIndex]?.focus();
  }

  return (
    <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" className="animate-fade-in">
      <section>
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Theme</h2>
        <ThemeSegmented className="mt-3" />
      </section>
      <section className="mt-6 border-t border-[var(--color-border-subtle)] pt-6">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Accent colour</h2>
        <div role="radiogroup" aria-label="Accent colour" className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {ACCENT_PRESETS.map((preset, index) => {
            const selected = preset.id === accent;
            const preview = resolvedTheme === 'dark' ? preset.dark.accent : preset.light.accent;
            return (
              <button
                key={preset.id}
                ref={(button) => {
                  swatches.current[index] = button;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectAccent(preset.id)}
                onKeyDown={(event) => {
                  const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : null;
                  if (direction === null) return;
                  event.preventDefault();
                  selectAdjacentAccent(index, direction);
                }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl p-2 text-xs font-medium text-[var(--color-text-secondary)] shadow-raised transition-colors',
                  selected
                    ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]'
                    : 'border border-[var(--color-border)]',
                )}
              >
                <span aria-hidden="true" className="h-8 w-8 rounded-lg" style={{ backgroundColor: preview }} />
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>
        {save.isError ? <Alert>{detailMessage(save.error)}</Alert> : null}
      </section>
    </div>
  );
}

function NotificationsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'app'], queryFn: settingsApi.getAppSettings });
  const [days, setDays] = useState('');
  const [warnPct, setWarnPct] = useState('');
  const touched = useRef(false);
  const pctTouched = useRef(false);
  useEffect(() => {
    if (settingsQuery.data && !touched.current) setDays(String(settingsQuery.data.decommission_notify_days));
    if (settingsQuery.data && !pctTouched.current) setWarnPct(String(settingsQuery.data.storage_usage_warn_pct));
  }, [settingsQuery.data]);
  const save = useMutation({
    mutationFn: () => settingsApi.updateAppSettings({ decommission_notify_days: Number(days) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  const savePct = useMutation({
    mutationFn: () => settingsApi.updateAppSettings({ storage_usage_warn_pct: Number(warnPct) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  return (
    <div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications" className="animate-fade-in">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (Number(days) >= 1) save.mutate(); }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]" htmlFor="notify-days">
            Days before decommission to warn
          </label>
          <input id="notify-days" type="number" min={1} className={inputClass + ' max-w-32'} value={days} onChange={(e) => { touched.current = true; setDays(e.target.value); }} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={save.isPending || Number(days) < 1}>
          {save.isPending ? <><Spinner /> Saving…</> : 'Save window'}
        </button>
        {save.isError ? <span className="text-sm font-medium text-[var(--color-criticality-critical)]" role="alert">{detailMessage(save.error)}</span> : null}
      </form>

      <form
        className="mt-6 flex flex-wrap items-end gap-2 border-t border-[var(--color-border-subtle)] pt-6"
        onSubmit={(e) => { e.preventDefault(); if (Number(warnPct) >= 1 && Number(warnPct) <= 100) savePct.mutate(); }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]" htmlFor="warn-pct">
            Storage usage warning threshold (%)
          </label>
          <input id="warn-pct" type="number" min={1} max={100} className={inputClass + ' max-w-32'} value={warnPct} onChange={(e) => { pctTouched.current = true; setWarnPct(e.target.value); }} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={savePct.isPending || Number(warnPct) < 1 || Number(warnPct) > 100}>
          {savePct.isPending ? <><Spinner /> Saving…</> : 'Save threshold'}
        </button>
        {savePct.isError ? <span className="text-sm font-medium text-[var(--color-criticality-critical)]" role="alert">{detailMessage(savePct.error)}</span> : null}
      </form>
    </div>
  );
}

export function SettingsPage() {
  const user = useCurrentUser();
  const [activeTab, setActiveTab] = useState<'appearance' | 'users' | 'notifications' | 'ldap'>('appearance');

  return (
    <PageTransition>
      <section className="mx-auto max-w-5xl">
        <PageHeader title="Settings" context="Administration" description="Manage appearance, notifications, users, and directory access." />
        <div className={cardClass}>
          <div
            className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)]"
            role="tablist"
            aria-label="Settings categories"
          >
            <button
              type="button"
              role="tab"
              id="tab-appearance"
              aria-selected={activeTab === 'appearance'}
              aria-controls="panel-appearance"
              onClick={() => setActiveTab('appearance')}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                activeTab === 'appearance'
                  ? 'border-[var(--color-accent)] bg-[var(--color-surface-tertiary)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              Appearance
            </button>
            {user.role === 'admin' ? (
              <>
                <button
                  type="button"
                  role="tab"
                  id="tab-users"
                  aria-selected={activeTab === 'users'}
                  aria-controls="panel-users"
                  onClick={() => setActiveTab('users')}
                  className={cn(
                    '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    activeTab === 'users'
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-tertiary)] text-[var(--color-accent-text)]'
                      : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  Users
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-notifications"
                  aria-selected={activeTab === 'notifications'}
                  aria-controls="panel-notifications"
                  onClick={() => setActiveTab('notifications')}
                  className={cn(
                    '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    activeTab === 'notifications'
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-tertiary)] text-[var(--color-accent-text)]'
                      : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  Notifications
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-ldap"
                  aria-selected={activeTab === 'ldap'}
                  aria-controls="panel-ldap"
                  onClick={() => setActiveTab('ldap')}
                  className={cn(
                    '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    activeTab === 'ldap'
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-tertiary)] text-[var(--color-accent-text)]'
                      : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  LDAP
                </button>
              </>
            ) : null}
          </div>
          <div>
            {activeTab === 'appearance' || user.role !== 'admin' ? (
              <AppearancePanel />
            ) : activeTab === 'users' ? (
              <div role="tabpanel" id="panel-users" aria-labelledby="tab-users" className="animate-fade-in">
                <UsersPanel />
              </div>
            ) : activeTab === 'notifications' ? (
              <NotificationsPanel />
            ) : (
              <LdapPanel />
            )}
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
