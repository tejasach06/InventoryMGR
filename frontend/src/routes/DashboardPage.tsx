'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, detailMessage } from '../api/client';
import { Alert, PageHeader, PageTransition, Skeleton } from '../components/ui';

function StatCard({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = (
    <div className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-900/[0.04] transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-none dark:hover:border-slate-700">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : <div>{content}</div>;
}

export function DashboardPage() {
  const dashQ = useQuery({ queryKey: ['dashboard'], queryFn: api.getDashboard });
  const d = dashQ.data;

  if (dashQ.isLoading) {
    return (
      <PageTransition>
        <PageHeader title="Dashboard" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-8 w-16" />
            </div>
          ))}
        </div>
      </PageTransition>
    );
  }

  if (dashQ.isError) return <PageTransition><Alert>{detailMessage(dashQ.error)}</Alert></PageTransition>;
  if (!d) return null;

  return (
    <PageTransition>
      <PageHeader title="Dashboard" />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatCard label="Total VMs" value={d.total} href="/inventory" />
          <StatCard label="Linux VMs" value={d.linux} href="/inventory?os_family=linux" />
          <StatCard label="Windows VMs" value={d.windows} href="/inventory?os_family=windows" />
          <StatCard label="Production" value={d.production} href="/inventory?environment=production" />
          <StatCard label="Development" value={d.development} href="/inventory?environment=development" />
          <StatCard label="Test / UAT" value={d.test_uat} />
          <StatCard label="Powered Off" value={d.powered_off} href="/inventory?status=powered_off" />
          <StatCard label="Without Monitoring" value={d.without_monitoring} href="/inventory?monitoring_enabled=false" />
          <StatCard label="Without Applications" value={d.without_applications} />
        </div>

        {d.recently_added.length > 0 && (
          <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Recently Added (last 30 days)</h2>
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {d.recently_added.map((vm) => (
                <li key={vm.id} className="flex items-center justify-between py-2">
                  <Link href={`/inventory/${vm.id}`} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">{vm.name}</Link>
                  <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{vm.environment}</span>
                    <span>{vm.status}</span>
                    <span>{new Date(vm.created_at).toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageTransition>
  );
}
