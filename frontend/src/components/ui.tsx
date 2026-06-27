import { ReactNode } from 'react';
import { cn } from '../lib/classNames';

export const primaryButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-indigo-500 dark:focus-visible:ring-offset-slate-950';
export const secondaryButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950';
export const dangerButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950';
export const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm shadow-slate-900/[0.02] transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/12 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/15 dark:disabled:bg-slate-900';
export const selectClass = cn(inputClass, 'app-select cursor-pointer');
export const textareaClass = cn(inputClass, 'min-h-28 resize-y');
export const cardClass = 'rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-900/[0.04] dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none dark:backdrop-blur';
export const tableWrapClass = 'overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-900/[0.04] dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-none';
export const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300';
export const helpTextClass = 'mt-2 text-sm text-slate-500 dark:text-slate-400';
export const sectionTitleClass = 'font-display text-[length:var(--text-fluid-h2)] font-semibold text-slate-950 dark:text-slate-100';
export const tableClass = 'min-w-full divide-y divide-slate-100 text-sm dark:divide-slate-800/70';
export const tableHeadClass = 'sticky top-0 z-10 bg-slate-50/90 text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-slate-500 backdrop-blur dark:bg-slate-900/90 dark:text-slate-400';
export const tableBodyClass = 'divide-y divide-slate-100 bg-white dark:divide-slate-800/70 dark:bg-transparent';
export const tableRowClass = 'transition-colors duration-100 hover:bg-indigo-50/40 dark:hover:bg-slate-800/50';
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
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">{eyebrow}</p> : null}
        <h1 className="font-display mt-1 text-[length:var(--text-fluid-h1)] font-semibold tracking-tight text-slate-950 dark:text-slate-50">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return (
    <div className={cn('my-4 rounded-lg border px-4 py-3 text-sm font-medium', alertTones[tone])} role={tone === 'error' ? 'alert' : 'status'}>
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
  return <span className={cn('inline-flex cursor-default items-center rounded-md border px-2 py-0.5 text-xs font-semibold capitalize', badgeTone[value] ?? 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300')}>{value}</span>;
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-10 text-center dark:border-slate-700 dark:bg-slate-900/70">
      {icon ? <div className="mb-4 flex justify-center text-slate-400 dark:text-slate-500">{icon}</div> : null}
      <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{body}</p>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800', className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className={tableWrapClass} role="status" aria-label="Loading">
      <table className={tableClass}>
        <thead className={tableHeadClass}>
          <tr>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="px-4 py-3"><Skeleton className="h-3 w-16" /></th>
            ))}
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className="px-4 py-3"><Skeleton className={cn('h-4', c === 0 ? 'w-32' : 'w-20')} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('animate-fade-in', className)}>{children}</div>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}
