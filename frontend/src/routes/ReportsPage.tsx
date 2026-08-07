'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, detailMessage } from '../api/client';
import { Alert, EmptyState, PageHeader, PageTransition, ProgressBar, Skeleton, cardClass, monoClass, primaryButtonClass, secondaryButtonClass } from '../components/ui';
import { cn } from '../lib/classNames';

interface ReportDef {
  name: string;
  label: string;
  description: string;
  suffix: string;
  colorVar?: string;
}

const REPORTS: ReportDef[] = [
  { name: 'linux', label: 'Linux Inventory', description: 'Every Linux-family guest', suffix: 'VMs', colorVar: 'var(--color-os_family-linux)' },
  { name: 'windows', label: 'Windows Inventory', description: 'Every Windows-family guest', suffix: 'VMs', colorVar: 'var(--color-os_family-windows)' },
  { name: 'production', label: 'Production Inventory', description: 'Workloads in the production environment', suffix: 'VMs', colorVar: 'var(--color-environment-production)' },
  { name: 'monitoring', label: 'Monitoring Status', description: 'Guests with monitoring enabled', suffix: 'monitored', colorVar: 'var(--color-accent)' },
  { name: 'applications', label: 'Application Inventory', description: 'Guests with at least one linked app', suffix: 'VMs', colorVar: 'var(--color-accent)' },
  { name: 'owner', label: 'Owner Report', description: 'Distinct business/technical owners', suffix: 'owners', colorVar: 'var(--color-accent)' },
  { name: 'pmp_access', label: 'PMP Access Report', description: 'VMs accessible via PMP', suffix: 'VMs', colorVar: 'var(--color-accent)' },
  { name: 'lifecycle', label: 'Lifecycle Report', description: 'Guests with a decommission date set', suffix: 'scheduled', colorVar: 'var(--color-lifecycle-retiring)' },
];

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V2m0 8L5 7m3 3 3-3" /><path d="M2 10v2.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V10" />
    </svg>
  );
}

export function ReportsPage() {
  const summaryQ = useQuery({ queryKey: ['reports', 'summary'], queryFn: api.getReportSummary });
  const total = summaryQ.data?.total_vms ?? 0;
  const counts = summaryQ.data?.counts ?? {};
  return (
    <PageTransition>
      <PageHeader title="Reports" eyebrow="Exports" actions={
        <a
          href={api.exportVmsUrl(new URLSearchParams('all=true'))}
          download="vm-inventory.csv"
          className={secondaryButtonClass}
        >
          <DownloadIcon /> Export all VMs
        </a>
      } />

      {summaryQ.isError ? <Alert>{detailMessage(summaryQ.error)}</Alert> : null}

      {!summaryQ.isLoading && !summaryQ.isError && total === 0 ? (
        <EmptyState
          title="No VMs to report on"
          body="Reports are generated from the VM inventory. Create or import VMs to populate these views."
          actions={
            <Link href="/inventory" className={primaryButtonClass}>
              Go to inventory
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {REPORTS.map((r) => {
              const value = summaryQ.isLoading ? 0 : (counts[r.name] ?? 0);
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <section key={r.name} className={`${cardClass} flex flex-col`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{r.label}</h2>
                      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{r.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {summaryQ.isLoading ? (
                        <Skeleton className="h-7 w-10" />
                      ) : (
                        <>
                          <span className={cn(monoClass, 'text-2xl font-bold text-[var(--color-text-primary)] tabular-nums')}>{value}</span>
                          <span className="ml-1 text-[0.7rem] uppercase tracking-wide text-[var(--color-text-tertiary)]">{r.suffix}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="mt-4">
                    <ProgressBar value={pct} label={`${r.label}: ${value} of ${total} VMs`} colorVar={r.colorVar} />
                  </div>
                  <div className="mt-4 flex justify-end border-t border-[var(--color-border)] pt-3">
                    <a href={api.reportUrl(r.name)} download={`${r.name}.csv`} className={secondaryButtonClass}>
                      <DownloadIcon /> Download CSV
                    </a>
                  </div>
                </section>
              );
            })}
          </div>
          <p className={cn(monoClass, 'mt-4 text-center tabular-nums')}>
            {summaryQ.isLoading ? 'loading…' : `${total} VMs across ${REPORTS.length} report views`}
          </p>
        </>
      )}
    </PageTransition>
  );
}
