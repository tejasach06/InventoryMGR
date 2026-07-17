'use client';

import Link from 'next/link';
import { Vm } from '../api/client';
import { cn } from '../lib/classNames';
import { formatMemory, formatDisks } from '../lib/units';
import { Badge, cardClass, eyebrowClass, monoClass, secondaryButtonClass } from './ui';

/** Health band → the same red/amber/green scale used for criticality, so the
 * ring never references an undefined CSS token. */
function healthColor(score: number): string {
  if (score >= 80) return 'var(--color-criticality-low)';
  if (score >= 50) return 'var(--color-criticality-medium)';
  return 'var(--color-criticality-critical)';
}

/** Small circular progress ring — the panel's signature data-viz moment,
 * not a library default. Pure SVG, no dependency. */
function HealthRing({ score }: { score: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = healthColor(score);
  return (
    <div className="relative flex h-20 w-20 flex-shrink-0 items-center justify-center">
      <svg viewBox="0 0 72 72" className="h-20 w-20 -rotate-90">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="var(--color-surface-tertiary)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 500ms var(--ease-out-expo)' }}
        />
      </svg>
      <span className={cn(monoClass, 'absolute text-base font-semibold')} style={{ color } as React.CSSProperties}>
        {score}
      </span>
    </div>
  );
}

/** Status-distribution stacked bar over the currently loaded result set —
 * a fleet "pulse" strip rather than another stat tile. */
function FleetPulse({ vms }: { vms: Vm[] }) {
  if (vms.length === 0) return null;
  const counts = new Map<string, number>();
  for (const vm of vms) counts.set(vm.status, (counts.get(vm.status) ?? 0) + 1);
  const segments = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <p className={eyebrowClass}>Fleet Pulse</p>
      <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-tertiary)]">
        {segments.map(([status, count]) => (
          <div
            key={status}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(count / vms.length) * 100}%`,
              backgroundColor: `var(--color-status-${status})`,
            }}
            title={`${status}: ${count}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map(([status, count]) => (
          <span key={status} className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--color-status-${status})` }} aria-hidden="true" />
            {status.replace('_', ' ')} <span className={monoClass}>{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[var(--color-border)]/50 last:border-0">
      <span className="text-xs uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{label}</span>
      <span className={cn(monoClass, 'text-sm text-[var(--color-text-primary)] dark:text-slate-200 text-right truncate max-w-[60%]')}>{value}</span>
    </div>
  );
}

interface ContextPanelProps {
  vms: Vm[];
  activeVm: Vm | null;
  onCloseActive: () => void;
  selectedCount: number;
  onExportSelected: () => void;
  onClearSelected: () => void;
}

export function ContextPanel({ vms, activeVm, onCloseActive, selectedCount, onExportSelected, onClearSelected }: ContextPanelProps) {
  return (
    <aside
      className="hidden lg:flex lg:sticky lg:top-8 lg:h-fit lg:w-full lg:max-w-full lg:flex-col lg:gap-5"
      aria-label="Inventory context panel"
    >
      <div className={cn(cardClass, 'p-5')}>
        <FleetPulse vms={vms} />
      </div>

      {selectedCount > 0 ? (
        <div className={cn(cardClass, 'p-5 border-[var(--color-accent)]/30 animate-fade-in')}>
          <p className={eyebrowClass}>Bulk Actions</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)] dark:text-slate-50">
            {selectedCount} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">selected</span>
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={onExportSelected} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]">
              Export selected
            </button>
            <button type="button" onClick={onClearSelected} className={secondaryButtonClass}>
              Clear selection
            </button>
          </div>
        </div>
      ) : activeVm ? (
        <div className={cn(cardClass, 'p-5 animate-fade-in')} style={{ borderTop: `3px solid var(--color-criticality-${activeVm.criticality})` } as React.CSSProperties}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={eyebrowClass}>Previewing</p>
              <h3 className="mt-1 font-display font-semibold text-lg text-[var(--color-text-primary)] dark:text-slate-100 truncate">{activeVm.name}</h3>
            </div>
            <button
              type="button"
              onClick={onCloseActive}
              className="flex-shrink-0 rounded-md p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)] dark:hover:text-slate-100 transition-colors"
              aria-label="Close preview"
            >
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-4">
            <HealthRing score={activeVm.health_score} />
            <div className="flex flex-1 flex-wrap gap-1.5">
              <Badge value={activeVm.status} type="status" />
              <Badge value={activeVm.criticality} type="criticality" />
              {activeVm.environment && <Badge value={activeVm.environment} type="environment" />}
            </div>
          </div>

          <div className="mt-4">
            <SpecRow label="Platform" value={activeVm.platform} />
            <SpecRow label="Cluster" value={activeVm.cluster} />
            <SpecRow label="Node" value={activeVm.node ?? '—'} />
            <SpecRow label="Resources" value={`${activeVm.cpu_cores} vCPU · ${formatMemory(activeVm.memory_mb)}`} />
            <SpecRow label="Storage" value={activeVm.disks?.length ? formatDisks(activeVm.disks.map((d) => d.size_gb)) : '—'} />
            <SpecRow label="Owner" value={activeVm.owner ?? '—'} />
            {activeVm.tags && activeVm.tags.length > 0 && (
              <SpecRow label="Tags" value={activeVm.tags.join(', ')} />
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <Link href={`/inventory/${activeVm.id}`} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]">
              Full record
            </Link>
            <Link href={`/inventory/${activeVm.id}/edit`} className={cn(secondaryButtonClass, 'flex-1 justify-center')}>
              Edit
            </Link>
          </div>
        </div>
      ) : (
        <div className={cn(cardClass, 'p-5 text-center')}>
          <p className={eyebrowClass}>Nothing previewed</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)] dark:text-slate-300 leading-relaxed">
            Click any row to preview its health, specs, and quick actions here — without leaving the list.
          </p>
        </div>
      )}
    </aside>
  );
}
