import Link from 'next/link';
import { EmptyState, primaryButtonClass, secondaryButtonClass } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--color-surface-secondary)] p-4">
      <div className="w-full max-w-lg">
        <EmptyState
          title="Page not found"
          body="That URL doesn't match anything in the inventory. It may have been renamed or the record deleted."
          actions={<>
            <Link href="/inventory" className={primaryButtonClass}>Open inventory</Link>
            <Link href="/dashboard" className={secondaryButtonClass}>Dashboard</Link>
          </>}
        />
      </div>
    </div>
  );
}
