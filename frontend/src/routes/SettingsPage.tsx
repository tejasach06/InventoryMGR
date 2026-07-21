'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, DropdownCategory, DropdownOption, OsFamily } from '../api/client';
import { Alert, Badge, PageHeader, PageTransition, Skeleton, Spinner, cardClass, dangerButtonClass, inputClass, primaryButtonClass, secondaryButtonClass } from '../components/ui';
import { cn } from '../lib/classNames';
import { UsersPanel } from './UsersPage';

const CATEGORY_ORDER: DropdownCategory[] = ['cpu', 'datacenter', 'disk', 'os', 'cluster'];
const CATEGORY_LABELS: Record<DropdownCategory, string> = {
  cpu: 'CPU cores',
  datacenter: 'Datacenter',
  disk: 'Disk size (GB)',
  os: 'Operating system',
  cluster: 'Cluster',
};

function OptionRow({ option }: { option: DropdownOption }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(option.value);
  const [familyDraft, setFamilyDraft] = useState<OsFamily | ''>(option.family ?? '');
  const isOs = option.category === 'os';

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['settings'] });
  }

  const update = useMutation({
    mutationFn: () => isOs ? api.updateDropdownOption(option.id, draft.trim(), familyDraft || null) : api.updateDropdownOption(option.id, draft.trim()),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
  });
  const remove = useMutation({ mutationFn: () => api.deleteDropdownOption(option.id), onSuccess: invalidate });

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 py-2">
        <label className="sr-only" htmlFor={`edit-${option.id}`}>Edit {option.value}</label>
        <input className={inputClass + ' max-w-48'} id={`edit-${option.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
        {isOs ? (
          <>
            <label className="sr-only" htmlFor={`edit-family-${option.id}`}>Family for {option.value}</label>
            <select className={inputClass + ' max-w-40'} id={`edit-family-${option.id}`} value={familyDraft} onChange={(event) => setFamilyDraft(event.target.value as OsFamily | '')}>
              <option value="">—</option>
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </select>
          </>
        ) : null}
        <button type="button" className={primaryButtonClass} onClick={() => draft.trim() && update.mutate()} disabled={update.isPending}>
          {update.isPending ? <><Spinner /> Saving…</> : 'Save'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => { setDraft(option.value); setEditing(false); }}>Cancel</button>
        {update.isError ? <span className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{detailMessage(update.error)}</span> : null}
      </li>
    );
  }

  return (
    <li className="group flex flex-wrap items-center gap-2 py-2">
      <span className="min-w-32 text-sm font-medium text-slate-800 dark:text-slate-200">{option.value}</span>
      {isOs && option.family ? <Badge value={option.family} /> : null}
      <div className="flex gap-2 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100">
        <button type="button" className={secondaryButtonClass} onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className={dangerButtonClass} onClick={() => { if (window.confirm(`Remove "${option.value}"?`)) remove.mutate(); }} disabled={remove.isPending}>
          {remove.isPending ? <><Spinner /> Removing…</> : 'Remove'}
        </button>
      </div>
      {remove.isError ? <span className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{detailMessage(remove.error)}</span> : null}
    </li>
  );
}

function CategoryPanel({ category, options }: { category: DropdownCategory; options: DropdownOption[] }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [family, setFamily] = useState<OsFamily | ''>('');
  const create = useMutation({
    mutationFn: () => category === 'os' ? api.createDropdownOption(category, value.trim(), family || null) : api.createDropdownOption(category, value.trim()),
    onSuccess: () => {
      setValue('');
      setFamily('');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim()) return;
    create.mutate();
  }

  return (
    <div role="tabpanel" id={`panel-${category}`} aria-labelledby={`tab-${category}`} className="animate-fade-in">
      <form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={submit}>
        <label className="sr-only" htmlFor={`add-${category}`}>Add {CATEGORY_LABELS[category]} option</label>
        <input className={inputClass + ' max-w-48'} id={`add-${category}`} value={value} onChange={(event) => setValue(event.target.value)} placeholder="New option" />
        {category === 'os' ? (
          <>
            <label className="sr-only" htmlFor={`add-family-${category}`}>OS family</label>
            <select className={inputClass + ' max-w-40'} id={`add-family-${category}`} value={family} onChange={(event) => setFamily(event.target.value as OsFamily | '')}>
              <option value="">—</option>
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </select>
          </>
        ) : null}
        <button type="submit" className={primaryButtonClass} disabled={create.isPending || !value.trim()}>
          {create.isPending ? <><Spinner /> Adding…</> : 'Add'}
        </button>
        {create.isError ? <span className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{detailMessage(create.error)}</span> : null}
      </form>
      {options.length > 0 ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {options.map((option) => <OptionRow key={option.id} option={option} />)}
        </ul>
      ) : (
        <p className="py-4 text-sm text-slate-500 dark:text-slate-400">No options yet. Add the first one above.</p>
      )}
    </div>
  );
}

function NotificationsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'app'], queryFn: api.getAppSettings });
  const [days, setDays] = useState('');
  const touched = useRef(false);
  useEffect(() => {
    // Only seed from the query once — a background refetch (or the async resolution
    // racing a user's own edit) must never clobber an in-progress edit.
    if (settingsQuery.data && !touched.current) setDays(String(settingsQuery.data.decommission_notify_days));
  }, [settingsQuery.data]);
  const save = useMutation({
    mutationFn: () => api.updateAppSettings({ decommission_notify_days: Number(days) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'app'] }),
  });
  return (
    <div role="tabpanel" id="panel-notifications" aria-labelledby="tab-notifications" className="animate-fade-in">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (Number(days) >= 1) save.mutate(); }}
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="notify-days">
            Days before decommission to warn
          </label>
          <input id="notify-days" type="number" min={1} className={inputClass + ' max-w-32'} value={days} onChange={(e) => { touched.current = true; setDays(e.target.value); }} />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={save.isPending || Number(days) < 1}>
          {save.isPending ? <><Spinner /> Saving…</> : 'Save window'}
        </button>
        {save.isError ? <span className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{detailMessage(save.error)}</span> : null}
      </form>
    </div>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<DropdownCategory | 'users' | 'notifications'>('cpu');
  const optionsQuery = useQuery({ queryKey: ['settings', 'options', 'all'], queryFn: api.getAllDropdownOptions });

  const grouped = useMemo(() => {
    const map: Record<DropdownCategory, DropdownOption[]> = { cpu: [], datacenter: [], disk: [], os: [], cluster: [] };
    for (const option of optionsQuery.data ?? []) {
      map[option.category].push(option);
    }
    map.cpu.sort((a, b) => Number(a.value) - Number(b.value));
    return map;
  }, [optionsQuery.data]);

  return (
    <PageTransition>
      <section>
        <PageHeader title="Settings" eyebrow="Admin only" />
        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">Manage the quick-select options shown in the VM form. Users can still type a custom value when none of these fit.</p>
        {optionsQuery.isError ? <Alert>{detailMessage(optionsQuery.error)}</Alert> : null}
        {optionsQuery.isLoading ? (
          <div className={cardClass} role="status" aria-label="Loading">
            <div className="flex gap-2 border-b pb-4"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-28" /></div>
            <div className="mt-4 space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          </div>
        ) : null}
        {optionsQuery.data ? (
          <div className={cardClass}>
            <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-100 dark:border-slate-800" role="tablist" aria-label="Settings categories">
              {CATEGORY_ORDER.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  id={`tab-${category}`}
                  aria-selected={activeTab === category}
                  aria-controls={`panel-${category}`}
                  onClick={() => setActiveTab(category)}
                  className={cn(
                    '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                    activeTab === category
                      ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                  )}
                >
                  {CATEGORY_LABELS[category]}
                </button>
              ))}
              <button
                key="users"
                type="button"
                role="tab"
                id="tab-users"
                aria-selected={activeTab === 'users'}
                aria-controls="panel-users"
                onClick={() => setActiveTab('users')}
                className={cn(
                  '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  activeTab === 'users'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                Users
              </button>
              <button
                key="notifications"
                type="button"
                role="tab"
                id="tab-notifications"
                aria-selected={activeTab === 'notifications'}
                aria-controls="panel-notifications"
                onClick={() => setActiveTab('notifications')}
                className={cn(
                  '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  activeTab === 'notifications'
                    ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                Notifications
              </button>
            </div>
            {activeTab === 'users' ? (
              <div role="tabpanel" id="panel-users" aria-labelledby="tab-users" className="animate-fade-in">
                <UsersPanel />
              </div>
            ) : activeTab === 'notifications' ? (
              <NotificationsPanel />
            ) : (
              <CategoryPanel category={activeTab} options={grouped[activeTab]} />
            )}
          </div>
        ) : null}
      </section>
    </PageTransition>
  );
}
