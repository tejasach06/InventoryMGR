'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { api, User } from '../api/client';
import { secondaryButtonClass } from './ui';
import { AppNav } from './AppNav';

interface LayoutProps {
  user: User;
  children: ReactNode;
}

export function AppLayout({ user, children }: LayoutProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  return (
    <div className="min-h-screen bg-slate-50 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_32rem),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.10),transparent_30rem)] lg:flex">
      <aside className="border-b border-slate-200/80 bg-white/90 px-4 py-4 shadow-sm backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col lg:border-b-0 lg:border-r lg:px-6 lg:py-6" aria-label="Primary navigation">
        <div className="flex items-center justify-between gap-4 lg:block">
          <div className="text-lg font-bold tracking-tight text-slate-950">InventoryMGR</div>
          <div className="lg:hidden">
            <button type="button" className={secondaryButtonClass} onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? 'Signing out…' : 'Logout'}
            </button>
          </div>
        </div>
        <AppNav user={user} />
        <div className="mt-4 hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:mt-auto lg:block">
          <div className="mb-3 min-w-0">
            <span className="block truncate text-sm font-medium text-slate-700">{user.email}</span>
            <strong className="mt-1 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">{user.role}</strong>
          </div>
          <button type="button" className={secondaryButtonClass + ' w-full'} onClick={() => logout.mutate()} disabled={logout.isPending}>
            {logout.isPending ? 'Signing out…' : 'Logout'}
          </button>
        </div>
      </aside>
      <main className="px-4 py-6 sm:px-6 lg:ml-72 lg:min-h-screen lg:flex-1 lg:px-8 lg:py-8" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
