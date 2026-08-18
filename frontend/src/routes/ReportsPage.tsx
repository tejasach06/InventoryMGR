'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { vms as vmsApi } from '../api/vms';
import { dashboard as dashboardApi } from '../api/dashboard';
import { detailMessage } from '../api/core';
import { Alert, EmptyState, PageHeader, PageTransition, ProgressBar, Skeleton, monoClass, primaryButtonClass, secondaryButtonClass } from '../components/ui';
import { cn } from '../lib/classNames';

interface ReportDef {
  name: string;
  label: string;
  description: string;
  suffix: string;
  colorVar?: string;
  coverage?: boolean;
}

const REPORTS: ReportDef[] = [
  { name: 'linux', label: 'Linux Inventory', description: 'Every Linux-family guest', suffix: 'VMs', colorVar: 'var(--color-os_family-linux)' },
  { name: 'windows', label: 'Windows Inventory', description: 'Every Windows-family guest', suffix: 'VMs', colorVar: 'var(--color-os_family-windows)' },
  { name: 'production', label: 'Production Inventory', description: 'Workloads in the production environment', suffix: 'VMs', colorVar: 'var(--color-environment-production)' },
  { name: 'monitoring', label: 'Monitoring Status', description: 'Guests with monitoring enabled', suffix: 'monitored' },
  { name: 'applications', label: 'Application Inventory', description: 'Guests with at least one linked app', suffix: 'VMs' },
  { name: 'owner', label: 'Owner Report', description: 'Distinct business/technical owners', suffix: 'owners', coverage: false },
  { name: 'pmp_access', label: 'PMP Access Report', description: 'VMs accessible via PMP', suffix: 'VMs' },
  { name: 'decommission', label: 'Decommission Report', description: 'Pending retirements with a decommission date', suffix: 'scheduled', colorVar: 'var(--color-status-powered_off)' },
];

function DownloadIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V2m0 8L5 7m3 3 3-3" /><path d="M2 10v2.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V10" />
    </svg>
  );
}

export function ReportsPage() {
  const summaryQ = useQuery({ queryKey: ['reports', 'summary'], queryFn: dashboardApi.getReportSummary });
  const total = summaryQ.data?.total_vms ?? 0;
  const counts = summaryQ.data?.counts ?? {};
  return (
    <PageTransition>
      <PageHeader title="Reports" context="Exports" description="Download focused fleet views with server-verified counts." actions={
        <a
          href={vmsApi.exportVmsUrl(new URLSearchParams('all=true'))}
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
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-surface)] shadow-[var(--shadow-raised)]">
            {REPORTS.map((report) => {
              const value = summaryQ.isLoading ? 0 : (counts[report.name] ?? 0);
              const pct = total > 0 ? Math.round((value / total) * 100) : 0;
              return (
                <section key={report.name} className="group grid gap-4 border-b border-[var(--color-border-subtle)] p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_10rem_auto] sm:items-center">
                  <div className="min-w-0"><h2 className="font-semibold text-[var(--color-text-primary)]">{report.label}</h2><p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{report.description}</p></div>
                  <div>{summaryQ.isLoading ? <Skeleton className="h-7 w-12" /> : <><span className={cn(monoClass, 'text-xl font-semibold text-[var(--color-text-primary)]')}>{value}</span><span className="ml-1 text-xs text-[var(--color-text-tertiary)]">{report.suffix}</span></>}</div>
                  <div>{report.coverage === false ? <span className="text-xs text-[var(--color-text-tertiary)]">Distinct count</span> : <ProgressBar value={pct} label={`${report.label}: ${value} of ${total} VMs`} colorVar={report.colorVar} />}</div>
                  <a href={dashboardApi.reportUrl(report.name)} download={`${report.name}.csv`} className={cn(secondaryButtonClass, 'whitespace-nowrap')}><DownloadIcon /> Download</a>
                </section>
              );
            })}
          </div>
          <p className={cn(monoClass, 'mt-4 text-center text-xs text-[var(--color-text-tertiary)] tabular-nums')}>
            {summaryQ.isLoading ? 'loading…' : `${total} VMs across ${REPORTS.length} report views`}
          </p>
        </>
      )}
    </PageTransition>
  );
}
