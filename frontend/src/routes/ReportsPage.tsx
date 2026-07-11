'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, detailMessage, Vm } from '../api/client';
import { Alert, PageHeader, PageTransition, Skeleton, cardClass, monoClass, secondaryButtonClass } from '../components/ui';

const ALL_PARAMS = new URLSearchParams({ limit: '200', offset: '0' });

interface ReportDef {
  name: string;
  label: string;
  description: string;
  metric: (vms: Vm[]) => number;
  suffix: string;
}

const REPORTS: ReportDef[] = [
  { name: 'linux', label: 'Linux Inventory', description: 'Every Linux-family guest', metric: (v) => v.filter((x) => x.os_family === 'linux').length, suffix: 'VMs' },
  { name: 'windows', label: 'Windows Inventory', description: 'Every Windows-family guest', metric: (v) => v.filter((x) => x.os_family === 'windows').length, suffix: 'VMs' },
  { name: 'production', label: 'Production Inventory', description: 'Workloads in the production environment', metric: (v) => v.filter((x) => x.environment === 'production').length, suffix: 'VMs' },
  { name: 'monitoring', label: 'Monitoring Status', description: 'Guests with monitoring enabled', metric: (v) => v.filter((x) => x.monitoring_enabled).length, suffix: 'monitored' },
  { name: 'applications', label: 'Application Inventory', description: 'Guests with at least one linked app', metric: (v) => v.filter((x) => x.applications.length > 0).length, suffix: 'VMs' },
  { name: 'owner', label: 'Owner Report', description: 'Distinct business/technical owners', metric: (v) => new Set(v.map((x) => x.owner).filter(Boolean)).size, suffix: 'owners' },
  { name: 'pmp_access', label: 'PMP Access Report', description: 'VMs accessible via PMP', metric: (v) => v.filter((x) => x.pmp_enabled).length, suffix: 'VMs' },
  { name: 'lifecycle', label: 'Lifecycle Report', description: 'Guests with a decommission date set', metric: (v) => v.filter((x) => x.decommission_date).length, suffix: 'scheduled' },
];

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V2m0 8L5 7m3 3 3-3" /><path d="M2 10v2.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V10" />
    </svg>
  );
}

export function ReportsPage() {
  const vmsQ = useQuery({ queryKey: ['vms', 'reports'], queryFn: () => api.listVms(ALL_PARAMS) });
  const items = useMemo(() => vmsQ.data?.items ?? [], [vmsQ.data]);
  const max = useMemo(() => Math.max(1, ...REPORTS.map((r) => r.metric(items))), [items]);

  return (
    <PageTransition>
      <PageHeader title="Reports" eyebrow="Exports" actions={
        <a
          href={api.exportVmsUrl(new URLSearchParams('all=true'))}
          target="_blank"
          rel="noopener"
          download="vm-inventory.csv"
          className={secondaryButtonClass}
        >
          <DownloadIcon /> Export all VMs
        </a>
      } />

      {vmsQ.isError ? <Alert>{detailMessage(vmsQ.error)}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((r) => {
          const value = vmsQ.isLoading ? 0 : r.metric(items);
          const pct = Math.round((value / max) * 100);
          return (
            <section key={r.name} className={`${cardClass} flex flex-col`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">{r.label}</h2>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{r.description}</p>
                </div>
                <div className="shrink-0 text-right">
                  {vmsQ.isLoading ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <>
                      <span className="tech text-2xl font-bold text-slate-950 dark:text-slate-50">{value}</span>
                      <span className="ml-1 text-[0.7rem] uppercase tracking-wide text-slate-400 dark:text-slate-500">{r.suffix}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
                <a href={api.reportUrl(r.name)} download={`${r.name}.csv`}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
                  <DownloadIcon /> Download CSV
                </a>
              </div>
            </section>
          );
        })}
      </div>
      <p className={`${monoClass} mt-4 text-center`}>{vmsQ.isLoading ? 'loading…' : `${items.length} VMs across ${REPORTS.length} report views`}</p>
    </PageTransition>
  );
}
