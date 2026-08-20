'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { vms as vmsApi } from '../api/vms';
import type { DueVm } from '../api/types';
import { cn } from '../lib/classNames';
import { monoClass } from './ui';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { data: decommissions = [] } = useQuery({
    queryKey: ['decommissions'],
    queryFn: vmsApi.decommissionNotifications,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: duplicates = [] } = useQuery({
    queryKey: ['duplicate-ips'],
    queryFn: vmsApi.duplicateIpNotifications,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
  });
  const decommissionUnread = decommissions.filter((d) => d.unread).length;
  const badgeCount = decommissionUnread + duplicates.length;

  const ack = useMutation({
    mutationFn: () => vmsApi.ackDecommissions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['decommissions'] }),
  });
  const dismiss = useMutation({
    mutationFn: (vmId: string) => vmsApi.ackDecommissions([vmId]),
    onMutate: async (vmId: string) => {
      await queryClient.cancelQueries({ queryKey: ['decommissions'] });
      const previous = queryClient.getQueryData<DueVm[]>(['decommissions']);
      queryClient.setQueryData<DueVm[]>(['decommissions'], (old = []) => old.filter((d) => d.vm_id !== vmId));
      return { previous };
    },
    onError: (_err, _vmId, context) => {
      if (context?.previous) queryClient.setQueryData(['decommissions'], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['decommissions'] }),
  });

  // ack-all-on-open: mark everything currently listed as read when the panel opens
  useEffect(() => {
    if (open && decommissionUnread > 0 && !ack.isPending) ack.mutate();
  }, [open]);

  // Close on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] shadow-[var(--shadow-raised)] transition-colors hover:bg-[var(--color-surface-tertiary)]"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {badgeCount > 0 ? (
          <span data-testid="notif-badge" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-criticality-critical)] px-1 text-xs font-semibold text-[var(--color-on-danger)]">
            {badgeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-10 mt-2 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-overlay)]" role="menu">
          {decommissions.length === 0 && duplicates.length === 0 ? (
            <p className="px-2 py-3 text-sm text-[var(--color-text-tertiary)]">Nothing to report.</p>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {duplicates.length > 0 ? (
                <div>
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-criticality-critical)]">
                    Duplicate IP addresses
                  </p>
                  <ul>
                    {duplicates.map((d) => (
                      <li key={`${d.role}-${d.ip_address}`}>
                        <Link
                          href={`/inventory?q=${encodeURIComponent(d.ip_address)}`}
                          onClick={() => setOpen(false)}
                          className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-[var(--color-criticality-critical)] hover:bg-[var(--color-surface-tertiary)]"
                        >
                          <span className={cn(monoClass, 'truncate font-medium text-[var(--color-criticality-critical)] tabular-nums')}>
                            {d.ip_address}
                          </span>
                          <span className={cn(monoClass, 'shrink-0 text-xs tabular-nums text-[var(--color-text-secondary)]')}>
                            {d.vms.length} VMs
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {decommissions.length > 0 ? (
                <div>
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    Upcoming decommissions
                  </p>
                  <ul>
                    {decommissions.map((d) => (
                      <li key={d.vm_id} className="flex items-center gap-1">
                        <Link
                          href={`/inventory/${d.vm_id}`}
                          onClick={() => setOpen(false)}
                          className={cn(
                            'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--color-surface-tertiary)]',
                            d.days_remaining < 0 ? 'text-[var(--color-criticality-critical)]' : 'text-[var(--color-text-secondary)]',
                          )}
                        >
                          <span className="truncate font-medium">{d.name}</span>
                          <span className="flex-shrink-0 text-xs">
                            {d.days_remaining < 0 ? `${-d.days_remaining}d overdue` : `in ${d.days_remaining}d`}
                          </span>
                        </Link>
                        <button
                          type="button"
                          aria-label={`Dismiss alert for ${d.name}`}
                          onClick={() => dismiss.mutate(d.vm_id)}
                          className="flex-shrink-0 rounded-full p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-secondary)]"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
