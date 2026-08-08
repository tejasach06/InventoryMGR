'use client';

import Link from 'next/link';
import { Alert, primaryButtonClass, monoClass } from '../components/ui';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--color-surface-secondary)] p-4">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] p-6 shadow-[var(--shadow-raised)]">
        <h1 className="font-display text-xl font-semibold text-[var(--color-text-primary)]">Something went wrong</h1>
        <Alert tone="error">
          We couldn't load this view. Try again or return to the dashboard.
        </Alert>
        {error.digest ? (
          <p className={monoClass}>Reference: {error.digest}</p>
        ) : null}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link href="/dashboard" className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
            Go to dashboard
          </Link>
          <button type="button" onClick={reset} className={primaryButtonClass}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
