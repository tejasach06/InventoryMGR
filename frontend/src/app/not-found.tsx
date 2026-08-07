import Link from 'next/link';
import { EmptyState, primaryButtonClass } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--color-surface-secondary)] p-4">
      <div className="w-full max-w-lg">
        <EmptyState
          title="Page not found"
          body="That URL doesn't match anything in the inventory. It may have been renamed or the record deleted."
          actions={
            <Link href="/dashboard" className={primaryButtonClass}>
              Go to dashboard
            </Link>
          }
        />
      </div>
    </div>
  );
}
