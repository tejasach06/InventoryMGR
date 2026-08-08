'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, detailMessage, ArrayPayload, StorageArrayListItem } from '../api/client';
import { Alert, Badge, PageHeader, PageTransition, TableSkeleton, EmptyState, primaryButtonClass, cardClass, tableWrapClass, tableClass, tableHeadClass, tableBodyClass, tableRowClass, tableCellClass, monoClass } from '../components/ui';
import { cn } from '../lib/classNames';
import { useCurrentUser } from '../components/AuthContext';
import { ArrayForm } from '../components/ArrayForm';

function UsageBar({ pct, over }: { pct: number | null; over: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-tertiary)]">
        {pct !== null && (
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${over ? 'bg-[var(--color-criticality-critical)]' : 'bg-[var(--color-text-secondary)]'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        )}
      </div>
      <span className={cn(monoClass, 'text-sm tabular-nums text-[var(--color-text-secondary)]')}>{pct === null ? '—' : `${pct}%`}</span>
    </div>
  );
}

function ThresholdBadge() {
  return <Badge value="Over threshold" tone={{ type: 'criticality', value: 'critical' }} />;
}

export function StoragePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const user = useCurrentUser();
  const canEdit = user.role === 'editor' || user.role === 'admin';
  const [showForm, setShowForm] = useState(false);

  const arraysQ = useQuery({ queryKey: ['arrays'], queryFn: () => api.listArrays() });
  const arrays: StorageArrayListItem[] = arraysQ.data ?? [];

  const createMut = useMutation({
    mutationFn: (payload: ArrayPayload) => api.createArray(payload),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['arrays'] });
      setShowForm(false);
      router.push(`/storage/${created.id}`);
    },
  });

  return (
    <PageTransition>
      <PageHeader title="Storage" context="Storage arrays" description="Review provisioned capacity, utilization, and attached volumes." actions={
        canEdit && !showForm ? (
          <button className={primaryButtonClass} onClick={() => setShowForm(true)}>+ New array</button>
        ) : null
      } />

      {canEdit && showForm ? (
        <div className={`${cardClass} mb-6`}>
          <ArrayForm
            onSubmit={(payload) => createMut.mutate(payload)}
            onCancel={() => setShowForm(false)}
            pending={createMut.isPending}
            submitLabel="Create array"
          />
          {createMut.isError ? <Alert>{detailMessage(createMut.error)}</Alert> : null}
        </div>
      ) : null}

      {arraysQ.isError ? <Alert>{detailMessage(arraysQ.error)}</Alert> : null}

      {arraysQ.isLoading ? (
        <TableSkeleton rows={4} cols={7} />
      ) : arrays.length === 0 ? (
        <EmptyState title="No storage arrays yet" body="Create the first array to document capacity and attached volumes." actions={canEdit ? <button className={primaryButtonClass} onClick={() => setShowForm(true)}>New array</button> : undefined} />
      ) : (
        <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={tableHeadClass}>
              <tr>
                <th className={`${tableCellClass} text-left font-semibold`} scope="col">Name</th>
                <th className={`${tableCellClass} text-left font-semibold`} scope="col">Vendor</th>
                <th className={`${tableCellClass} text-left font-semibold`} scope="col">Datacenter</th>
                <th className={`${tableCellClass} text-left font-semibold`} scope="col">Usage</th>
                <th className={`${tableCellClass} text-right font-semibold`} scope="col">Volumes</th>
                <th className={`${tableCellClass} text-right font-semibold`} scope="col">LUNs</th>
                <th className={`${tableCellClass} text-right font-semibold`} scope="col">Shares</th>
              </tr>
            </thead>
            <tbody className={tableBodyClass}>
              {arrays.map((a) => (
                <tr key={a.id} className={tableRowClass}>
                  <td className={tableCellClass}>
                    <Link href={`/storage/${a.id}`} className="font-medium hover:underline text-[var(--color-accent)]">
                      {a.name}
                    </Link>
                    {a.over_threshold ? <span className="ml-2"><ThresholdBadge /></span> : null}
                  </td>
                  <td className={tableCellClass}>{a.vendor}</td>
                  <td className={tableCellClass}>{a.datacenter ?? '—'}</td>
                  <td className={tableCellClass}><UsageBar pct={a.used_pct} over={a.over_threshold} /></td>
                  <td className={cn(tableCellClass, monoClass, 'text-right tabular-nums')}>{a.volume_count}</td>
                  <td className={cn(tableCellClass, monoClass, 'text-right tabular-nums')}>{a.lun_count}</td>
                  <td className={cn(tableCellClass, monoClass, 'text-right tabular-nums')}>{a.share_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageTransition>
  );
}
