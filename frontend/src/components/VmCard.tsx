'use client';

import Link from 'next/link';
import { Vm } from '../api/client';
import { Badge, cardClass, monoClass } from '../components/ui';
import { formatMemory, formatDisks } from '../lib/units';
import { cn } from '../lib/classNames';

function VmCard({ vm }: { vm: Vm }) {
  return (
    <Link
      href={`/inventory/${vm.id}`}
      className={cn(
        cardClass,
        'block p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)] hover:border-[var(--color-accent)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]'
      )}
    >
      {/* Primary row: name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-[0.9375rem] text-[var(--color-text-primary)] truncate">{vm.name}</h3>
          <p className={cn('mt-0.5 text-xs text-[var(--color-text-tertiary)]', monoClass)}>{vm.platform} · {vm.cluster}</p>
        </div>
        <Badge value={vm.status} type="status" size="sm" />
      </div>

      {/* Metric row: cpu / ram / storage, bento-tile mini-grid */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg bg-[var(--color-surface-secondary)] p-2">
        <div className="text-center">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)]')}>{vm.cpu_cores}</p>
          <p className="eyebrow-label text-[0.5625rem]">vCPU</p>
        </div>
        <div className="text-center border-x border-[var(--color-border)]">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)]')}>{formatMemory(vm.memory_mb)}</p>
          <p className="eyebrow-label text-[0.5625rem]">Memory</p>
        </div>
        <div className="text-center">
          <p className={cn(monoClass, 'text-sm font-semibold text-[var(--color-text-primary)]')}>{vm.disks?.length ? formatDisks(vm.disks.map((d) => d.size_gb)) : '—'}</p>
          <p className="eyebrow-label text-[0.5625rem]">Storage</p>
        </div>
      </div>

      {/* Badge cluster */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge value={vm.criticality} type="criticality" size="sm" />
        {vm.environment && <Badge value={vm.environment} type="environment" size="sm" />}
        {vm.os_family && <Badge value={vm.os_family} type="os_family" size="sm" />}
        {vm.owner && <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--color-text-secondary)]">{vm.owner}</span>}
        {vm.tags && vm.tags.length > 0 && (
          <span className="inline-flex items-center rounded-md bg-[var(--color-surface-tertiary)] px-2 py-1 text-[0.6875rem] text-[var(--color-text-tertiary)]">
            {vm.tags.slice(0, 2).join(', ')}{vm.tags.length > 2 && ` +${vm.tags.length - 2}`}
          </span>
        )}
      </div>
    </Link>
  );
}

export { VmCard };