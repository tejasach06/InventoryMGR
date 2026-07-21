'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, detailMessage, StorageArrayListItem } from '../api/client';
import { Alert, PageHeader, PageTransition, Skeleton, cardClass, tableWrapClass, tableClass, tableHeadClass, tableBodyClass, tableRowClass, tableCellClass } from '../components/ui';

function UsageBar({ pct, over }: { pct: number | null; over: boolean }) {
  if (pct === null) return <span className="text-sm text-slate-400 dark:text-slate-500">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${over ? 'bg-rose-500' : 'bg-indigo-500'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="tech text-sm tabular-nums text-slate-600 dark:text-slate-300">{pct}%</span>
    </div>
  );
}

function ThresholdBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-1 text-[0.6875rem] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
      Over threshold
    </span>
  );
}

export function StoragePage() {
  const arraysQ = useQuery({ queryKey: ['arrays'], queryFn: () => api.listArrays() });
  const arrays: StorageArrayListItem[] = arraysQ.data ?? [];

  return (
    <PageTransition>
      <PageHeader title="Storage" eyebrow="Infrastructure" />

      {arraysQ.isError ? <Alert>{detailMessage(arraysQ.error)}</Alert> : null}

      {arraysQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : arrays.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-slate-500 dark:text-slate-400`}>
          No storage arrays yet.
        </div>
      ) : (
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={`${tableCellClass} text-left font-semibold`}>Name</th>
                <th className={`${tableCellClass} text-left font-semibold`}>Vendor</th>
                <th className={`${tableCellClass} text-left font-semibold`}>Datacenter</th>
                <th className={`${tableCellClass} text-left font-semibold`}>Usage</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Volumes</th>
                <th className={`${tableCellClass} text-right font-semibold`}>LUNs</th>
                <th className={`${tableCellClass} text-right font-semibold`}>Shares</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {arrays.map((a) => (
                <tr key={a.id} className={tableRowClass}>
                  <td className={tableCellClass}>
                    <Link href={`/storage/${a.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {a.name}
                    </Link>
                    {a.over_threshold ? <span className="ml-2"><ThresholdBadge /></span> : null}
                  </td>
                  <td className={tableCellClass}>{a.vendor}</td>
                  <td className={tableCellClass}>{a.datacenter ?? '—'}</td>
                  <td className={tableCellClass}><UsageBar pct={a.used_pct} over={a.over_threshold} /></td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{a.volume_count}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{a.lun_count}</td>
                  <td className={`${tableCellClass} text-right tabular-nums`}>{a.share_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageTransition>
  );
}
