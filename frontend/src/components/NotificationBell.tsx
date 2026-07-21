'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { cn } from '../lib/classNames';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ['decommissions'],
    queryFn: api.decommissionNotifications,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000,
  });
  const unread = data.filter((d) => d.unread).length;

  const ack = useMutation({
    mutationFn: () => api.ackDecommissions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['decommissions'] }),
  });

  // ack-all-on-open: mark everything currently listed as read when the panel opens
  useEffect(() => {
    if (open && unread > 0 && !ack.isPending) ack.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="fixed right-4 top-4 z-30">
      <button
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span data-testid="notif-badge" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900" role="menu">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming decommissions</p>
          {data.length === 0 ? (
            <p className="px-2 py-3 text-sm text-slate-500 dark:text-slate-400">No upcoming decommissions.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {data.map((d) => (
                <li key={d.vm_id}>
                  <Link
                    href={`/inventory/${d.vm_id}`}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800',
                      d.days_remaining < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200',
                    )}
                  >
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="flex-shrink-0 text-xs">
                      {d.days_remaining < 0 ? `${-d.days_remaining}d overdue` : `in ${d.days_remaining}d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
