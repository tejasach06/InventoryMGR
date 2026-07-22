'use client';

import Link from 'next/link';
import { ReactNode, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, detailMessage, Vm } from '../api/client';
import { Alert, Badge, PageHeader, PageTransition, Skeleton, cardClass, monoClass } from '../components/ui';

const ALL_PARAMS = new URLSearchParams({ limit: '200', offset: '0' });

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
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-slate-800" />
      {total > 0 && drawn.map((s) => {
        const len = (s.value / total) * c;
        const seg = (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += len;
        return seg;
      })}
      <text x="50%" y="46%" textAnchor="middle" className="fill-slate-950 tech dark:fill-slate-50" style={{ fontSize: 30, fontWeight: 700 }}>{total}</text>
      <text x="50%" y="60%" textAnchor="middle" className="fill-slate-400 dark:fill-slate-500" style={{ fontSize: 10, letterSpacing: '0.14em' }}>MACHINES</text>
    </svg>
  );
}

function BarList({ rows }: { rows: { key: string; label: string; value: number; bar: string; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = Math.round((r.value / max) * 100);
        const inner = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium capitalize text-slate-700 group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white">{r.label}</span>
              <span className={monoClass}>{fmtInt(r.value)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={`h-full rounded-full ${r.bar} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? <Link href={r.href} className="group block">{inner}</Link> : <div className="group">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function StatTile({ label, value, unit, href, hint }: { label: string; value: string; unit?: string; href?: string; hint?: string }) {
  const inner = (
    <div className="group flex h-full flex-col justify-between rounded-xl border border-slate-200/70 bg-white p-4 transition-colors hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-indigo-500/40">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-3 flex items-baseline gap-1">
        <span className="tech text-2xl font-bold text-slate-950 dark:text-slate-50">{value}</span>
        {unit ? <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Panel({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`${cardClass} ${className}`}>
      <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function tally(items: Vm[], key: (vm: Vm) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const vm of items) {
    const k = key(vm);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function DashboardPage() {
  const statsQ = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboard });
  const vmsQ = useQuery({ queryKey: ['vms', 'dashboard'], queryFn: () => api.listVms(ALL_PARAMS) });
  const arraysQ = useQuery({ queryKey: ['arrays'], queryFn: () => api.listArrays() });
  const arraysOverThreshold = (arraysQ.data ?? []).filter((a) => a.over_threshold).length;

  const derived = useMemo(() => {
    const items = vmsQ.data?.items ?? [];
    const totalVcpu = items.reduce((a, v) => a + (v.cpu_cores || 0), 0);
    const totalMem = items.reduce((a, v) => a + (v.memory_mb || 0), 0) / 1024;
    const totalDisk = items.reduce((a, v) => a + v.disks.reduce((s, disk) => s + (disk.size_gb || 0), 0), 0);
    return {
      items,
      totalVcpu,
      totalMem,
      totalDisk,
      byStatus: tally(items, (v) => v.status),
      byEnv: tally(items, (v) => v.environment),
      byCrit: tally(items, (v) => v.criticality),
      byOs: tally(items, (v) => v.os_family),
    };
  }, [vmsQ.data]);

  if (statsQ.isError || vmsQ.isError) {
    return (
      <PageTransition>
        <PageHeader title="Overview" eyebrow="Infrastructure" />
        <Alert>{detailMessage(statsQ.error ?? vmsQ.error)}</Alert>
      </PageTransition>
    );
  }

  const loading = statsQ.isLoading || vmsQ.isLoading;
  const d = statsQ.data;

  const powerSegments: Segment[] = [
    { label: 'Running', value: derived.byStatus.running ?? 0, color: '#10b981' },
    { label: 'Powered off', value: derived.byStatus.powered_off ?? 0, color: '#ef4444' },
    { label: 'Suspended', value: derived.byStatus.suspended ?? 0, color: '#f59e0b' },
    { label: 'Other', value: Math.max(0, derived.items.length - (derived.byStatus.running ?? 0) - (derived.byStatus.powered_off ?? 0) - (derived.byStatus.suspended ?? 0)), color: '#64748b' },
  ];

  const envBars = Object.entries(derived.byEnv)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: key, value, bar: 'bg-indigo-500', href: `/inventory?environment=${key}` }));

  const critOrder = ['critical', 'high', 'medium', 'low'];
  const critBars = critOrder.filter((k) => derived.byCrit[k]).map((key) => ({
    key,
    label: key,
    value: derived.byCrit[key],
    bar: key === 'critical' ? 'bg-red-500' : key === 'high' ? 'bg-amber-500' : key === 'medium' ? 'bg-blue-500' : 'bg-emerald-500',
    href: `/inventory?criticality=${key}`,
  }));

  const mem = fmtCapacity(derived.totalMem).split(' ');
  const disk = fmtCapacity(derived.totalDisk).split(' ');

  return (
    <PageTransition>
      <PageHeader title="Overview" eyebrow="Infrastructure" actions={
        <Link href="/inventory" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">Open inventory →</Link>
      } />

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200/70 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <Skeleton className="h-3 w-20" /><Skeleton className="mt-4 h-7 w-16" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Total VMs" value={fmtInt(d?.total ?? derived.items.length)} href="/inventory" hint={`${d?.linux ?? derived.byOs.linux ?? 0} Linux · ${d?.windows ?? derived.byOs.windows ?? 0} Windows`} />
            <StatTile label="Running" value={fmtInt(derived.byStatus.running ?? 0)} href="/inventory?status=running" hint={`${derived.byStatus.powered_off ?? 0} powered off`} />
            <StatTile label="Allocated vCPU" value={fmtInt(derived.totalVcpu)} unit="cores" />
            <StatTile label="Allocated Memory" value={mem[0]} unit={mem[1]} />
            <StatTile label="Provisioned Storage" value={disk[0]} unit={disk[1]} />
            <StatTile label="Storage alerts" value={fmtInt(arraysOverThreshold)} unit="arrays" href="/storage" hint="over usage threshold" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Power state">
              <div className="flex items-center gap-5">
                <Donut segments={powerSegments} total={derived.items.length} />
                <ul className="min-w-0 flex-1 space-y-2">
                  {powerSegments.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
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
              {envBars.length ? <BarList rows={envBars} /> : <p className="text-sm text-slate-400 dark:text-slate-500">No environment data.</p>}
            </Panel>

            <Panel title="By criticality">
              {critBars.length ? <BarList rows={critBars} /> : <p className="text-sm text-slate-400 dark:text-slate-500">No criticality data.</p>}
            </Panel>
          </div>

          {d && d.recently_added.length > 0 && (
            <Panel title="Recently added · last 30 days">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {d.recently_added.map((vm) => (
                  <li key={vm.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/inventory/${vm.id}`} className="tech text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{vm.name}</Link>
                    <div className="flex items-center gap-3">
                      <Badge value={vm.status} />
                      <span className="hidden text-xs capitalize text-slate-400 dark:text-slate-500 sm:inline">{vm.environment}</span>
                      <span className={`${monoClass} hidden sm:inline`}>{new Date(vm.created_at).toLocaleDateString('en-CA')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </PageTransition>
  );
}
