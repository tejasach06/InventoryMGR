import { ReactNode, useEffect } from 'react';
import { cn } from '../lib/classNames';

export const primaryButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950';
export const secondaryButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-all duration-150 hover:bg-[var(--color-surface-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--color-border)] dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950';
export const dangerButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg bg-[var(--color-criticality-critical)] px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-criticality-critical)] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950';

/* Form controls */
export const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-text-primary)] shadow-sm shadow-slate-900/[0.02] transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent)]/12 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-tertiary)] dark:border-[var(--color-border)] dark:bg-slate-900 dark:text-slate-100 dark:shadow-none dark:placeholder:text-slate-500 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/15 dark:disabled:bg-slate-900';
export const selectClass = cn(inputClass, 'app-select cursor-pointer');
export const textareaClass = cn(inputClass, 'min-h-28 resize-y');

/* Layout components */
export const cardClass = 'rounded-xl border border-[var(--color-border)]/70 bg-white p-5 shadow-sm shadow-slate-900/[0.04] dark:border-[var(--color-border)] dark:bg-slate-900/70 dark:shadow-none dark:backdrop-blur';
export const tableWrapClass = 'overflow-x-auto rounded-xl border border-[var(--color-border)]/70 bg-white shadow-sm shadow-slate-900/[0.04] dark:border-[var(--color-border)] dark:bg-slate-900/70 dark:shadow-none';

/* FilterBar — distinct "control deck" surface, tinted so it reads apart from data cards */
export const filterBarClass = 'mb-4 rounded-xl border border-[var(--color-accent)]/25 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-accent)_5%,var(--color-surface)),var(--color-surface))] p-4 shadow-[var(--shadow-raised)] dark:border-[var(--color-accent)]/25 dark:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-accent)_10%,#0f172a),#0f172a)]';

/* Bento stat tile */
export const statTileClass = 'bento-tile rounded-xl border border-[var(--color-border)]/70 bg-white p-4 dark:border-[var(--color-border)] dark:bg-slate-900/70';

/* Typography */
export const labelClass = 'mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)] dark:text-slate-300';
export const helpTextClass = 'mt-2 text-sm text-[var(--color-text-tertiary)] dark:text-slate-400';
export const sectionTitleClass = 'font-display text-[length:var(--text-fluid-h2)] font-semibold text-[var(--color-text-primary)] dark:text-slate-100';
export const eyebrowClass = 'eyebrow-label';


/* Table */
export const tableClass = 'w-full min-w-full divide-y divide-[var(--color-border)] text-sm dark:divide-[var(--color-border)]/70';
export const tableHeadClass = 'sticky top-0 z-10 bg-[var(--color-surface-tertiary)]/90 text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] backdrop-blur dark:bg-slate-900/90 dark:text-slate-400';
export const tableBodyClass = 'divide-y divide-[var(--color-border)] bg-white dark:divide-[var(--color-border)]/70 dark:bg-transparent';
export const tableRowClass = 'transition-all duration-200 odd:bg-white even:bg-[var(--color-surface-secondary)]/60 hover:bg-[var(--color-accent)]/5 dark:odd:bg-transparent dark:even:bg-slate-900/40 dark:hover:bg-slate-800/50';
export const tableCellClass = 'whitespace-nowrap px-4 py-3 text-[var(--color-text-primary)] dark:text-slate-300';

/* Technical values: IPs, hostnames, UUIDs, sizes, counts. */
export const monoClass = 'tech text-[0.8125rem] text-[var(--color-text-secondary)] dark:text-slate-300';

/* Semantic color helpers — use inline styles with CSS variables */
export function semanticBg(type: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle', value: string) {
  return { backgroundColor: `var(--color-${type}-${value}-bg)` } as React.CSSProperties;
}
export function semanticFg(type: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle', value: string) {
  return { color: `var(--color-${type}-${value})` } as React.CSSProperties;
}
export function semanticBorder(type: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle', value: string) {
  return { borderColor: `var(--color-${type}-${value})` } as React.CSSProperties;
}

/* Row accent — left border + hover wash */
export function rowAccent(type: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle', value: string) {
  return {
    borderLeft: `3px solid var(--color-${type}-${value})`,
    backgroundColor: 'transparent',
  } as React.CSSProperties;
}
export function rowAccentHover(type: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle', value: string) {
  return {
    backgroundColor: `color-mix(in srgb, var(--color-${type}-${value}) 12%, transparent)`,
  } as React.CSSProperties;
}


/* Badge with semantic color. size="sm" for dense table cells, "md" for card contexts. */
export function Badge({ value, type = 'status', size = 'sm' }: { value: string; type?: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle'; size?: 'sm' | 'md' }) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md font-semibold leading-none transition-all duration-150 hover:brightness-95 dark:hover:brightness-110',
        size === 'sm' ? 'px-2 py-1 text-[0.6875rem] tracking-[0.01em]' : 'px-2.5 py-1.5 text-xs tracking-[0.02em]',
        'animate-pill-pop'
      )}
      style={{
        backgroundColor: `var(--color-${type}-${normalized}-bg)`,
        color: `var(--color-${type}-${normalized})`,
      } as React.CSSProperties}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--color-${type}-${normalized})` } as React.CSSProperties}
        aria-hidden="true"
      />
      {value}
    </span>
  );
}

/* PageHeader */
export function PageHeader({ title, actions, eyebrow }: { title: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 grid gap-4 sm:flex sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow-label text-[var(--color-accent)]">{eyebrow}</p> : null}
        <h1 className="font-display mt-1 text-[length:var(--text-fluid-h1)] font-semibold leading-[1.05] tracking-tight text-[var(--color-text-primary)] dark:text-slate-50">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* Alert */
export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'success' }) {
  const tones = {
    error: { bg: 'var(--color-criticality-critical-bg)', fg: 'var(--color-criticality-critical)', border: 'var(--color-criticality-critical)' },
    info: { bg: 'var(--color-environment-uat-bg)', fg: 'var(--color-environment-uat)', border: 'var(--color-environment-uat)' },
    success: { bg: 'var(--color-status-running-bg)', fg: 'var(--color-status-running)', border: 'var(--color-status-running)' },
  };
  const t = tones[tone];
  return (
    <div
      className="rounded-lg border p-4 text-sm"
      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border } as React.CSSProperties}
      role="alert"
    >
      {children}
    </div>
  );
}

/* FieldError */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-sm" style={{ color: 'var(--color-criticality-critical)' } as React.CSSProperties}>
      {message}
    </p>
  );
}

/* EmptyState */
export function EmptyState({ title, body, icon, actions }: { title: string; body: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cn(cardClass, 'flex flex-col items-center justify-center gap-4 py-20 px-4 text-center')}>
      {icon ? (
        <div className="text-7xl text-[var(--color-text-secondary)] dark:text-slate-400 mb-3 transition-transform hover:scale-110 duration-300">
          {icon}
        </div>
      ) : (
        <div className="mb-3 transition-transform duration-300 hover:scale-110">
          <svg className="h-16 w-16 mx-auto text-[var(--color-accent)] dark:text-indigo-400" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            {/* Box outline */}
            <rect x="15" y="20" width="70" height="60" rx="4" strokeLinecap="round" strokeLinejoin="round" />
            {/* Box fold lines */}
            <path d="M15 20L30 10M85 20L70 10M30 10L70 10" strokeLinecap="round" strokeLinejoin="round" />
            {/* Center circle accent */}
            <circle cx="50" cy="50" r="8" fill="currentColor" opacity="0.3" />
          </svg>
        </div>
      )}
      <h3 className="font-display text-xl font-semibold text-[var(--color-text-primary)] dark:text-slate-100">{title}</h3>
      <p className="text-base text-[var(--color-text-secondary)] dark:text-slate-300 max-w-md leading-relaxed">{body}</p>
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* Spinner */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin h-5 w-5', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

/* Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded-lg bg-[var(--color-surface-tertiary)] dark:bg-slate-800', className)} aria-hidden="true" />;
}

/* TableSkeleton */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className={tableWrapClass}>
      <table className={tableClass} role="table" aria-label="Loading data">
        <thead>
          <tr className={tableHeadClass}>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="px-4 py-3"><Skeleton className="h-4 w-full" /></th>
            ))}
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} className={tableRowClass}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} className={tableCellClass}><Skeleton className="h-4 w-full" /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* PageTransition */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('animate-fade-in', className)}>{children}</div>;
}

/* Logo */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={cn('h-6 w-6', className)} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="url(#grad)" />
      <path d="M8 12h16M8 16h12M8 20h8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* Drawer */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div className="relative ml-auto w-full max-w-xl bg-white rounded-tl-2xl rounded-bl-2xl shadow-xl dark:bg-slate-950 animate-rise overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 dark:border-[var(--color-border)]">
          <h2 id="drawer-title" className="font-display text-lg font-semibold text-[var(--color-text-primary)] dark:text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] transition-colors" aria-label="Close">
            <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="border-t border-[var(--color-border)] px-5 py-4 flex gap-2 justify-end bg-white dark:bg-slate-950">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* RemoveButton — small destructive icon action for inline table/list rows */
export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-criticality-critical)]/40 hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)] dark:bg-slate-800">
      ×
    </button>
  );
}

/* SectionCard — shared wrapper for detail/form section cards */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={cardClass}>
      <h2 className={sectionTitleClass}>{title}</h2>
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">{children}</div>
    </section>
  );
}

/* ProgressBar — progress indicator with semantic color */
export function ProgressBar({ value, colorVar = 'var(--color-accent)' }: { value: number; colorVar?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full" style={{ backgroundColor: 'var(--color-surface-tertiary)' }}>
      <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: colorVar }} />
    </div>
  );
}

/* Chip for filter bar */
export function FilterChip({ label, value, onRemove, type = 'status' }: { label: string; value: string; onRemove: () => void; type?: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle' }) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 hover:shadow-md animate-pill-pop',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] dark:focus-visible:ring-offset-slate-950'
      )}
      style={{
        backgroundColor: `var(--color-${type}-${normalized}-bg)`,
        color: `var(--color-${type}-${normalized})`,
        borderColor: `var(--color-${type}-${normalized})`,
      } as React.CSSProperties}
    >
      <span><span className="opacity-75 font-medium">{label}:</span>{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="p-1 rounded-md hover:bg-black/15 dark:hover:bg-white/15 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
        aria-label={`Remove ${label} filter`}
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </span>
  );
}
