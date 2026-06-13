import { ReactNode } from 'react';
import { cn } from '../lib/classNames';

export const primaryButtonClass = 'inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButtonClass = 'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
export const dangerButtonClass = 'inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
export const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-100';
export const selectClass = inputClass;
export const textareaClass = cn(inputClass, 'min-h-28 resize-y');
export const cardClass = 'rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur';
export const tableWrapClass = 'overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm';

const alertTones = {
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

const badgeTone: Record<string, string> = {
  running: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  create: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  stopped: 'border-red-200 bg-red-50 text-red-700',
  invalid: 'border-red-200 bg-red-50 text-red-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
  suspended: 'border-amber-200 bg-amber-50 text-amber-700',
  conflict: 'border-amber-200 bg-amber-50 text-amber-700',
  high: 'border-amber-200 bg-amber-50 text-amber-700',
  retiring: 'border-amber-200 bg-amber-50 text-amber-700',
  unknown: 'border-blue-200 bg-blue-50 text-blue-700',
  update: 'border-blue-200 bg-blue-50 text-blue-700',
  medium: 'border-blue-200 bg-blue-50 text-blue-700',
  planned: 'border-violet-200 bg-violet-50 text-violet-700',
  retired: 'border-slate-200 bg-slate-100 text-slate-700',
};

export function PageHeader({ title, actions, eyebrow }: { title: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 grid gap-4 sm:flex sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">{eyebrow}</p> : null}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
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
    <p id={id} className="mt-1 text-sm font-medium text-red-700">
      {message}
    </p>
  );
}

export function Badge({ value }: { value: string }) {
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize', badgeTone[value] ?? 'border-slate-200 bg-slate-100 text-slate-700')}>{value}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}
