'use client';

import { selectClass } from './ui';

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export function PaginationFooter({
  total,
  page,
  size,
  onPageChange,
  onSizeChange,
}: {
  total: number;
  page: number;
  size: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  // One page and a default page size means there is nothing to control.
  if (total <= PAGE_SIZES[0] && pageCount === 1) return null;

  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, total);

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-[var(--color-text-secondary)]">
        <span className="tech tabular-nums">{first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}</span>
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <span className="whitespace-nowrap">Rows</span>
          <select
            aria-label="Rows per page"
            className={`${selectClass} w-auto py-1.5`}
            value={size}
            onChange={(event) => onSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-tertiary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-tertiary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>

        {/* Announced so a screen-reader user hears the page change, not just the rows swap. */}
        <p aria-live="polite" className="text-sm text-[var(--color-text-secondary)] tabular-nums">
          Page {page} of {pageCount}
        </p>
      </div>
    </div>
  );
}
