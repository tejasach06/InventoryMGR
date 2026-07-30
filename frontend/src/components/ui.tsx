import { ReactNode, useEffect, useRef } from 'react';
import { cn } from '../lib/classNames';

export const primaryButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] transition-all duration-150 hover:bg-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-all duration-150 hover:bg-[var(--color-surface-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60';
export const dangerButtonClass = 'inline-flex items-center gap-2 justify-center rounded-lg bg-[var(--color-criticality-critical)] px-4 py-2 text-sm font-medium text-[var(--color-on-danger)] transition-all duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-criticality-critical)] focus-visible:ring-offset-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60';

/* Form controls */
export const inputClass = 'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-raised)] transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent)]/12 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-tertiary)]';
export const selectClass = cn(inputClass, 'app-select cursor-pointer');
export const textareaClass = cn(inputClass, 'min-h-28 resize-y');

/* Auth-only underline field. Deliberate exception to the boxed inputClass used by
   every in-app form — see DESIGN.md §5 "Login exceptions". Do not use outside /login. */
export const authInputClass = 'w-full border-0 border-b border-[var(--color-border)] bg-transparent px-1 py-3 text-sm text-[var(--color-text-primary)] transition-colors duration-200 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

/* Layout components */
export const cardClass = 'rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] p-5 shadow-[var(--shadow-raised)] backdrop-blur';
export const tableWrapClass = 'overflow-x-auto rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] shadow-[var(--shadow-raised)]';

/* FilterBar — neutral control deck surface */
export const filterBarClass = 'mb-4 rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] p-4 shadow-[var(--shadow-raised)] backdrop-blur';

/* Bento stat tile */
export const statTileClass = 'bento-tile rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] p-4';

/* Typography */
export const labelClass = 'mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]';
export const helpTextClass = 'mt-2 text-sm text-[var(--color-text-tertiary)]';
export const sectionTitleClass = 'font-display text-[length:var(--text-fluid-h2)] font-semibold text-[var(--color-text-primary)]';
export const eyebrowClass = 'eyebrow-label';


/* Table */
export const tableClass = 'w-full min-w-full divide-y divide-[var(--color-border)] text-sm';
export const tableHeadClass = 'sticky top-0 z-10 bg-[var(--color-surface-tertiary)]/90 text-left text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] backdrop-blur';
export const tableBodyClass = 'divide-y divide-[var(--color-border)] bg-[var(--color-surface)]';
export const tableRowClass = 'transition-colors duration-200 odd:bg-[var(--color-surface)] even:bg-[var(--color-surface-secondary)]/60 hover:bg-[var(--color-accent)]/5';
export const tableCellClass = 'whitespace-nowrap px-4 py-3 text-[var(--color-text-primary)]';

/* Technical values: IPs, hostnames, UUIDs, sizes, counts. */
export const monoClass = 'tech text-[0.8125rem] text-[var(--color-text-secondary)]';

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



/* Badge with semantic color. size="sm" for dense table cells, "md" for card contexts. */
export function Badge({ value, type = 'status', size = 'sm' }: { value: string; type?: 'status' | 'criticality' | 'environment' | 'platform' | 'os_family' | 'lifecycle'; size?: 'sm' | 'md' }) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
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
export function PageHeader({ title, actions, eyebrow }: { title: string; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-8 grid gap-4 sm:flex sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <div className="eyebrow-label text-[var(--color-accent)]">{eyebrow}</div> : null}
        <h1 className="font-display mt-1 text-[length:var(--text-fluid-h1)] font-semibold leading-[1.05] tracking-tight text-[var(--color-text-primary)]">{title}</h1>
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
        <div className="text-7xl text-[var(--color-text-secondary)] mb-3 transition-transform hover:scale-110 duration-300">
          {icon}
        </div>
      ) : (
        <div className="mb-3 transition-transform duration-300 hover:scale-110">
          <svg className="h-16 w-16 mx-auto text-[var(--color-accent)]" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {/* Outer radar sweep & node matrix */}
            <circle cx="32" cy="32" r="28" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.4" />
            <circle cx="32" cy="32" r="20" strokeWidth="1.5" opacity="0.6" />
            <circle cx="32" cy="32" r="10" strokeWidth="1.5" opacity="0.8" />
            <path d="M32 4v56M4 32h56" strokeWidth="1" opacity="0.25" />
            <circle cx="32" cy="32" r="3" fill="currentColor" />
            <circle cx="42" cy="22" r="2.5" fill="currentColor" className="animate-pulse" />
            <circle cx="20" cy="38" r="2" fill="currentColor" opacity="0.7" />
          </svg>
        </div>
      )}
      <h3 className="font-display text-xl font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <p className="text-base text-[var(--color-text-secondary)] max-w-md leading-relaxed">{body}</p>
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
  return <div className={cn('animate-shimmer rounded-lg bg-[var(--color-surface-tertiary)]', className)} aria-hidden="true" />;
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

/* Logo — the single app-wide mark. Tile is part of the mark; never wrap it in
   another tinted container. Mirrors public icon.svg / src/app/icon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={cn('h-8 w-8', className)} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
      <g fill="none" stroke="#ffffff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="7" width="18" height="7.5" rx="2.2" />
        <rect x="7" y="17.5" width="18" height="7.5" rx="2.2" />
        <line x1="11" y1="10.75" x2="11.01" y2="10.75" />
        <line x1="11" y1="21.25" x2="11.01" y2="21.25" />
      </g>
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
      <div className="absolute inset-0 bg-[var(--color-scrim)] backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div className="relative ml-auto w-full max-w-xl bg-[var(--color-surface)] rounded-tl-2xl rounded-bl-2xl shadow-[var(--shadow-overlay)] animate-rise overflow-hidden flex flex-col">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 id="drawer-title" className="font-display text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] transition-colors" aria-label="Close">
            <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="border-t border-[var(--color-border)] px-5 py-4 flex gap-2 justify-end bg-[var(--color-surface)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ConfirmDialog — styled replacement for native confirm() on destructive actions */
export function ConfirmDialog({
  open, title, body, children, confirmLabel = 'Delete', tone = 'danger', pending = false, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  children?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
        next?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="absolute inset-0 bg-[var(--color-scrim)] backdrop-blur-sm animate-fade-in" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-2xl bg-[var(--color-surface)] p-5 shadow-[var(--shadow-overlay)] animate-rise">
        <h2 id="confirm-title" className="font-display text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{body}</p>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={secondaryButtonClass} onClick={onCancel} disabled={pending}>Cancel</button>
          <button ref={confirmRef} type="button" className={tone === 'primary' ? primaryButtonClass : dangerButtonClass} onClick={onConfirm} disabled={pending}>
            {pending ? <Spinner /> : null}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* RemoveButton — small destructive icon action for inline table/list rows */
export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-tertiary)] transition-colors hover:border-[var(--color-criticality-critical)]/40 hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)]">
      ×
    </button>
  );
}

export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* SectionCard — shared wrapper for detail/form section cards */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id={slugifyTitle(title)} className={cn(cardClass, 'scroll-mt-20')}>
      <h2 className={sectionTitleClass}>{title}</h2>
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">{children}</div>
    </section>
  );
}

/* SectionNav — sticky jump-nav for pages with many stacked SectionCards */
export function SectionNav({ titles }: { titles: string[] }) {
  return (
    <nav aria-label="Jump to section" className="sticky top-0 z-10 -mx-1 mb-4 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)]/90 px-1 py-2 backdrop-blur">
      <ul className="flex gap-1 whitespace-nowrap text-sm">
        {titles.map((title) => (
          <li key={title}>
            <a href={`#${slugifyTitle(title)}`} className="inline-block rounded-md px-2.5 py-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)]">
              {title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
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
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-[var(--color-surface)]'
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
        className="p-1 rounded-md hover:bg-[var(--color-surface-tertiary)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-[var(--color-surface)]"
        aria-label={`Remove ${label} filter`}
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </span>
  );
}
