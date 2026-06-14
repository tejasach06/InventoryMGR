import { ReactNode } from 'react';
import { cn } from '../lib/classNames';

export const primaryButtonClass = 'inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950';
export const secondaryButtonClass = 'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950';
export const dangerButtonClass = 'inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950';
export const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20 dark:disabled:bg-slate-900';
export const selectClass = inputClass;
export const textareaClass = cn(inputClass, 'min-h-28 resize-y');
export const cardClass = 'rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90';
export const tableWrapClass = 'overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/90';
export const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300';
export const helpTextClass = 'mt-2 text-sm text-slate-500 dark:text-slate-400';
export const sectionTitleClass = 'text-lg font-semibold text-slate-950 dark:text-slate-100';
export const tableClass = 'min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800';
export const tableHeadClass = 'bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400';
export const tableBodyClass = 'divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950/60';
export const tableRowClass = 'transition hover:bg-slate-50/80 dark:hover:bg-slate-800/60';
export const tableCellClass = 'whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300';

const emeraldTone = 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
const redTone = 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300';
const amberTone = 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
const blueTone = 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300';

const alertTones = {
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
};

const badgeTone: Record<string, string> = {
  running: emeraldTone,
  create: emeraldTone,
  low: emeraldTone,
  active: emeraldTone,
  stopped: redTone,
  invalid: redTone,
  critical: redTone,
  suspended: amberTone,
  conflict: amberTone,
  high: amberTone,
  retiring: amberTone,
  unknown: blueTone,
  update: blueTone,
  medium: blueTone,
  planned: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
  retired: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function PageHeader({ title, actions, eyebrow }: { title: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 grid gap-4 sm:flex sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">{eyebrow}</p> : null}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return (
    <div className={cn('my-4 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm', alertTones[tone])} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-medium text-red-700 dark:text-red-300">
      {message}
    </p>
  );
}

export function Badge({ value }: { value: string }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize', badgeTone[value] ?? 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300')}>{value}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
      <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{body}</p>
    </div>
  );
}
