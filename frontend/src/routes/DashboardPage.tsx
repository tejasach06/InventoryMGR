'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboard as dashboardApi } from '../api/dashboard';
import { storage as storageApi } from '../api/storage';
import { detailMessage } from '../api/core';
import type { DashboardAlertVm } from '../api/types';
import { PageHeader, PageTransition, ProgressBar, Skeleton, cardClass, monoClass, primaryButtonClass, secondaryButtonClass, statTileClass } from '../components/ui';
import { cn } from '../lib/classNames';

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}
function fmtCapacity(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(gb % 1024 === 0 ? 0 : 1)} TB`;
  return `${Math.round(gb)} GB`;
}

interface Segment { label: string; value: number; color: string; }

// Hand-rolled SVG donut for power-state breakdown.
function Donut({ segments, total }: { segments: Segment[]; total: number }) {
  const size = 168;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const drawn = segments.filter((s) => s.value > 0);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Power state distribution" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'var(--color-surface-secondary)' }} />
      {total > 0 &&
        drawn.map((s) => {
          const len = (s.value / total) * c;
          const dashOffset = offset;
          offset += len;
          return (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
        })}
      <text x={size / 2} y={size / 2 - 2} textAnchor="middle" dominantBaseline="middle" className={cn(monoClass, 'fill-[var(--color-text-primary)] text-2xl font-bold tabular-nums')}>
        {fmtInt(total)}
      </text>
      <text x={size / 2} y={size / 2 + 18} textAnchor="middle" dominantBaseline="middle" className="fill-[var(--color-text-tertiary)] text-[0.625rem] font-semibold tracking-wider">
        VMs
      </text>
    </svg>
  );
}

function BarList({ rows, total }: { rows: { key: string; label: string; value: number; colorVar: string; href?: string }[]; total: number }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
        const content = (
          <div className="group flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)] transition-colors">
                {r.label}
              </span>
              <span className={cn(monoClass, 'text-xs text-[var(--color-text-secondary)]')}>
                {fmtInt(r.value)} <span className="text-[var(--color-text-tertiary)]">({pct}%)</span>
              </span>
            </div>
            <ProgressBar value={pct} label={`${r.label}: ${fmtInt(r.value)} VMs, ${pct}%`} colorVar={r.colorVar} />
          </div>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href}>
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatTile({
  label,
  value,
  unit,
  href,
  hint,
  alertTone = 'normal',
}: {
  label: string;
  value: string;
  unit?: string;
  href?: string;
  hint?: string;
  alertTone?: 'critical' | 'normal';
}) {
  const isAlert = alertTone === 'critical';
  const inner = (
    <div
      className={cn(
        statTileClass,
        'group flex h-full flex-col justify-between transition-all duration-150',
        isAlert
          ? 'border-[var(--color-criticality-critical)]/40 bg-[var(--color-criticality-critical-bg)] shadow-[var(--shadow-raised)] hover:border-[var(--color-criticality-critical)]/70'
          : 'hover:border-[var(--color-accent)]/40 hover:shadow-[var(--shadow-raised)]'
      )}
    >
      <p className={cn('text-[0.7rem] font-semibold uppercase tracking-[0.1em]', isAlert ? 'text-[var(--color-criticality-critical)]' : 'text-[var(--color-text-tertiary)]')}>
        {label}
      </p>
      <p className="mt-3 flex items-baseline gap-1">
        <span className={cn(monoClass, 'text-2xl font-bold tabular-nums', isAlert ? 'text-[var(--color-criticality-critical)]' : 'text-[var(--color-text-primary)]')}>
          {value}
        </span>
        {unit ? (
          <span className={cn('text-xs font-medium', isAlert ? 'text-[var(--color-criticality-critical)]' : 'text-[var(--color-text-tertiary)]')}>
            {unit}
          </span>
        ) : null}
      </p>
      {hint ? (
        <p className={cn('mt-1 text-xs', isAlert ? 'font-medium text-[var(--color-criticality-critical)]' : 'text-[var(--color-text-tertiary)]')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}


type AlertGroupTone = 'critical' | 'warning' | 'info';

const ALERT_TONE_CLASS: Record<AlertGroupTone, string> = {
  critical: 'text-[var(--color-criticality-critical)]',
  warning: 'text-[var(--color-warning)]',
  info: 'text-[var(--color-status-powered_off)]',
};

function AlertGroupIcon({ tone }: { tone: AlertGroupTone }) {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {tone === 'critical' ? (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      ) : tone === 'warning' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      ) : (
        <>
          <path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" />
          <path d="M2 11h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z" />
          <path d="m6 6 12 12" />
        </>
      )}
    </svg>
  );
}

const ALERT_ROWS_SHOWN = 5;

function AlertGroup({
  title, tone, toneLabel, rows, meta, href, hrefLabel,
}: {
  title: string;
  tone: AlertGroupTone;
  toneLabel: string;
  rows: DashboardAlertVm[];
  meta: (vm: DashboardAlertVm) => string;
  href: string;
  hrefLabel: string;
}) {
  const shown = rows.slice(0, ALERT_ROWS_SHOWN);
  const hidden = rows.length - shown.length;
  return (
    <div className="flex flex-1 flex-col p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className={ALERT_TONE_CLASS[tone]}><AlertGroupIcon tone={tone} /></span>
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h4>
        <span className={cn(monoClass, 'ml-auto text-[0.625rem] uppercase tracking-wider tabular-nums', ALERT_TONE_CLASS[tone])}>{toneLabel}</span>
      </div>
      {rows.length === 0 ? (
        <p className="flex-1 text-sm text-[var(--color-text-tertiary)]">None.</p>
      ) : (
        <ul className="mb-4 flex-1 divide-y divide-[var(--color-border-subtle)]">
          {shown.map((vm) => (
            <li key={vm.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/inventory/${vm.id}`} className={cn(monoClass, 'min-w-0 truncate text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent-text)] tabular-nums')}>
                {vm.name}
              </Link>
              <span className={cn(monoClass, 'shrink-0 text-xs tabular-nums')}>{meta(vm)}</span>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="py-2 text-xs text-[var(--color-text-tertiary)]">+{hidden} more</li>
          ) : null}
        </ul>
      )}
      <Link href={href} className={cn(secondaryButtonClass, 'w-full justify-center py-1.5 text-xs')} aria-label={hrefLabel}>
        {hrefLabel}
      </Link>
    </div>
  );
}

function Panel({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`${cardClass} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function DashboardPage() {
  const statsQ = useQuery({ queryKey: ['dashboard'], queryFn: dashboardApi.getDashboard });
  const arraysQ = useQuery({ queryKey: ['arrays'], queryFn: () => storageApi.listArrays() });
  const arraysOverThreshold = (arraysQ.data ?? []).filter((a) => a.over_threshold).length;
  const infrastructureState = arraysQ.isLoading ? 'checking' : arraysQ.isError ? 'unavailable' : arraysOverThreshold > 0 ? 'risk' : 'operational';

  const loading = statsQ.isLoading;
  const d = statsQ.data;
  const total = d?.total ?? 0;
  const byStatus = d?.by_status ?? {};
  const byEnv = d?.by_environment ?? {};
  const byCrit = d?.by_criticality ?? {};
  const totalVcpu = d?.total_vcpu ?? 0;
  const totalMem = d?.total_memory_gb ?? 0;
  const totalDisk = d?.total_disk_gb ?? 0;

  const runningCount = byStatus.running ?? 0;
  const poweredOffCount = byStatus.powered_off ?? 0;
  const otherCount = Math.max(0, total - runningCount - poweredOffCount);

  const powerSegments: Segment[] = [
    { label: 'Running', value: runningCount, color: 'var(--color-status-running)' },
    { label: 'Powered off', value: poweredOffCount, color: 'var(--color-status-powered_off)' },
    { label: 'Other', value: otherCount, color: 'var(--color-status-unknown)' },
  ];

  const envBars = Object.entries(byEnv)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => {
      const norm = key.toLowerCase().replace(/\s+/g, '_');
      return { key, label: key, value, colorVar: `var(--color-environment-${norm})`, href: `/inventory?environment=${key}` };
    });

  const critOrder = ['critical', 'high', 'medium', 'low'];
  const critBars = critOrder.filter((k) => (byCrit[k] ?? 0) > 0).map((key) => ({
    key,
    label: key,
    value: byCrit[key],
    colorVar: key === 'critical' ? 'var(--color-criticality-critical)' : key === 'high' ? 'var(--color-criticality-high)' : key === 'medium' ? 'var(--color-criticality-medium)' : 'var(--color-criticality-low)',
    href: `/inventory?criticality=${key}`,
  }));

  const mem = fmtCapacity(totalMem).split(' ');
  const disk = fmtCapacity(totalDisk).split(' ');
  return (
    <PageTransition>
      <PageHeader title="Overview" context="Infrastructure" description="Live fleet health, capacity, and operational exceptions." />
      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-4 h-8 w-14" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className={cn(
            "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[var(--color-border)]/70 p-4 shadow-[var(--shadow-raised)] transition-all",
            infrastructureState === 'risk'
              ? "border-[var(--color-criticality-critical)]/40 bg-[var(--color-criticality-critical-bg)] text-[var(--color-text-primary)]"
              : "bg-[var(--color-surface)]"
          )}>
            <div className="flex items-center gap-3">
              <span className={cn(
                "h-3 w-3 shrink-0 rounded-full",
                infrastructureState === 'risk' ? "bg-[var(--color-criticality-critical)]" : infrastructureState === 'operational' ? "bg-[var(--color-status-running)]" : "bg-[var(--color-text-tertiary)]"
              )} />
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {infrastructureState === 'checking' ? 'Checking infrastructure…'
                    : infrastructureState === 'unavailable' ? 'Storage status unavailable'
                    : infrastructureState === 'risk' ? `${arraysOverThreshold} storage array${arraysOverThreshold === 1 ? '' : 's'} exceed usage threshold`
                    : 'Fleet operational'}
                </h2>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {fmtInt(total)} VMs tracked across clusters and storage arrays
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {infrastructureState === 'risk' && (
                <Link href="/storage" className={cn(primaryButtonClass, 'px-3 py-1.5 text-xs bg-[var(--color-criticality-critical)] text-[var(--color-on-danger)] hover:opacity-90')}>
                  View Storage Alerts →
                </Link>
              )}
              {infrastructureState === 'operational' ? <Link href="/inventory" className="text-xs font-medium text-[var(--color-accent-text)] hover:underline">Open fleet inventory →</Link> : null}
            </div>
          </div>
          {statsQ.isError ? (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--color-criticality-critical)]/30 bg-[var(--color-criticality-critical-bg)] p-4 text-sm text-[var(--color-criticality-critical)]">
              <span>Failed to refresh metrics: {detailMessage(statsQ.error)}</span>
              <button
                type="button"
                className="rounded-lg bg-[var(--color-criticality-critical)] px-3 py-1 text-xs font-semibold text-[var(--color-on-danger)] hover:opacity-90 transition-colors"
                onClick={() => { statsQ.refetch(); }}
              >
                Retry
              </button>
            </div>
          ) : null}

          {/* Balanced 6-column Stat Tile Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Total VMs" value={fmtInt(total)} href="/inventory" hint={`${d?.linux ?? 0} Linux · ${d?.windows ?? 0} Windows`} />
            <StatTile label="Running" value={fmtInt(runningCount)} href="/inventory?status=running" hint={`${poweredOffCount} powered off`} />
            <StatTile label="Allocated vCPU" value={fmtInt(totalVcpu)} unit="cores" />
            <StatTile label="Allocated Memory" value={mem[0]} unit={mem[1]} />
            <StatTile label="Provisioned Storage" value={disk[0]} unit={disk[1]} />
            <StatTile
              label="Storage alerts"
              value={fmtInt(arraysOverThreshold)}
              unit="arrays"
              href="/storage"
              hint={arraysOverThreshold > 0 ? 'above threshold' : 'all within threshold'}
              alertTone={arraysOverThreshold > 0 ? 'critical' : 'normal'}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Power state">
              <div className="flex flex-col items-center gap-5 sm:flex-row">
                <Donut segments={powerSegments} total={total} />
                <ul className="min-w-0 flex-1 space-y-2">
                  {powerSegments.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <span className={monoClass}>{s.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>

            <Panel title="By environment">
              {envBars.length ? <BarList rows={envBars} total={total} /> : <p className="text-sm text-[var(--color-text-tertiary)]">No environment data.</p>}
            </Panel>

            <Panel title="By criticality">
              {critBars.length ? <BarList rows={critBars} total={total} /> : <p className="text-sm text-[var(--color-text-tertiary)]">No criticality data.</p>}
            </Panel>
          </div>

          {d ? (() => {
            const groups = [
              { key: 'shutdown', title: 'Powered off > 90 days', tone: 'info' as const, toneLabel: 'Stale', rows: d.shutdown_stale,
                meta: (vm: DashboardAlertVm) => `${vm.days}d shutdown`,
                href: '/inventory?shutdown_stale=true', hrefLabel: 'View stale shutdowns' },
              { key: 'overdue', title: 'Past decommission date', tone: 'critical' as const, toneLabel: 'Critical', rows: d.decommission_overdue,
                meta: (vm: DashboardAlertVm) => `${vm.days}d overdue`,
                href: '/inventory?decommission_overdue=true', hrefLabel: 'View overdue VMs' },
              { key: 'noip', title: 'No IP address', tone: 'warning' as const, toneLabel: 'Warning', rows: d.missing_ip,
                meta: () => 'no IP',
                href: '/inventory?missing_ip=true', hrefLabel: 'View VMs without IPs' },
              { key: 'dupip', title: 'Duplicate IP address', tone: 'critical' as const, toneLabel: 'Critical', rows: d.duplicate_ip,
                meta: (vm: DashboardAlertVm) => vm.detail ?? 'duplicate IP',
                href: '/inventory?duplicate_ip=true', hrefLabel: 'View VMs with duplicate IPs' },
            ];
            const total = groups.reduce((n, g) => n + g.rows.length, 0);
            return (
              <section className="overflow-hidden rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] shadow-[var(--shadow-raised)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)]/70 bg-[var(--color-surface-tertiary)] px-5 py-4">
                  <div>
                    <p className={cn(monoClass, 'text-[0.625rem] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] tabular-nums')}>Infrastructure status</p>
                    <h2 className="text-base font-semibold text-[var(--color-text-primary)]">VM Alerts</h2>
                  </div>
                  <span
                    className={cn(
                      monoClass,
                      'shrink-0 rounded-md px-2 py-1 text-xs tabular-nums',
                      total > 0 ? 'text-[var(--color-criticality-critical)]' : 'text-[var(--color-text-tertiary)]'
                    )}
                  >
                    {total > 0 ? `${fmtInt(total)} active` : 'All clear'}
                  </span>
                </div>
                {total === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <p className="text-sm font-semibold tracking-wide text-[var(--color-status-running)]">All clear</p>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">No stale shutdowns, overdue decommissions, missing IPs, or duplicate IPs.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 divide-y divide-[var(--color-border)]/70 sm:grid-cols-2 sm:divide-y-0 sm:gap-px sm:bg-[var(--color-border)]/70 lg:grid-cols-4 [&>*]:bg-[var(--color-surface)]">
                    {groups.map(({ key, ...g }) => <AlertGroup key={key} {...g} />)}
                  </div>
                )}
              </section>
            );
          })() : null}
        </div>
      )}
    </PageTransition>
  );
}
