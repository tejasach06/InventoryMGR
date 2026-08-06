'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage } from '../api/client';
import { PageHeader, PageTransition, Spinner, cardClass, inputClass, primaryButtonClass } from '../components/ui';
import { cn } from '../lib/classNames';
import { UsersPanel } from './UsersPage';
import { LdapPanel } from './LdapSettingsPanel';

function NotificationsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'app'], queryFn: api.getAppSettings });
  const [days, setDays] = useState('');
  const [warnPct, setWarnPct] = useState('');
  const touched = useRef(false);
  const pctTouched = useRef(false);
  useEffect(() => {
    if (settingsQuery.data && !touched.current) setDays(String(settingsQuery.data.decommission_notify_days));
    if (settingsQuery.data && !pctTouched.current) setWarnPct(String(settingsQuery.data.storage_usage_warn_pct));
  }, [settingsQuery.data]);
  const save = useMutation({
    mutationFn: () => api.updateAppSettings({ decommission_notify_days: Number(days) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  const savePct = useMutation({
    mutationFn: () => api.updateAppSettings({ storage_usage_warn_pct: Number(warnPct) }),
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
  const [activeTab, setActiveTab] = useState<'users' | 'notifications' | 'ldap'>('users');

  return (
    <PageTransition>
      <section>
        <PageHeader title="Settings" eyebrow="Admin only" />
        <div className={cardClass}>
          <div
            className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)]"
            role="tablist"
            aria-label="Settings categories"
          >
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
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
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
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
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
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              LDAP
            </button>
          </div>
          <div>
            {activeTab === 'users' ? (
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
