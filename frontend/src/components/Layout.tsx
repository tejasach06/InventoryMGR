'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode, useCallback, useState } from 'react';
import { api, User } from '../api/client';
import { Logo, secondaryButtonClass } from './ui';
import { AppNav } from './AppNav';
import { ThemeSelect } from './ThemeProvider';
import { NotificationBell } from './NotificationBell';

interface LayoutProps {
  user: User;
  children: ReactNode;
}

export function AppLayout({ user, children }: LayoutProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 lg:flex">
      <NotificationBell />
      <aside className={`sticky top-0 z-20 border-b border-slate-100 bg-white/95 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:border-b-0 lg:border-r lg:py-6 ${collapsed ? 'lg:w-16 lg:px-3' : 'lg:w-60 lg:px-5'}`} aria-label="Primary navigation">
        <div className="flex items-center justify-between gap-4 lg:block">
          <div className={`flex items-center gap-2.5 ${collapsed ? 'lg:w-full lg:flex-col lg:items-center lg:gap-2' : ''}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 lg:inline-flex dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white"
            >
              <svg className={`h-4 w-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 4L6 8l4 4" />
              </svg>
            </button>
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-600/30" aria-hidden="true">
              <Logo className="h-[18px] w-[18px]" />
            </span>
            {!collapsed && <span className="font-display text-[1.05rem] font-semibold tracking-tight text-slate-950 dark:text-slate-50">Inventory<span className="text-indigo-600 dark:text-indigo-400">MGR</span></span>}
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <ThemeSelect />
            <button type="button" className={secondaryButtonClass} onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? 'Signing out…' : 'Logout'}
            </button>
          </div>
        </div>
        <AppNav user={user} collapsed={collapsed} />
        <div className={`mt-4 hidden pt-4 dark:border-slate-800 lg:mt-auto lg:block ${collapsed ? '' : 'border-t border-slate-100'}`}>
          {!collapsed && (
            <>
              <ThemeSelect className="mb-3 w-full justify-between" />
              <div className="mb-3 min-w-0">
                <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-300">{user.email}</span>
                <strong className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{user.role}</strong>
              </div>
              <button type="button" className={secondaryButtonClass + ' w-full'} onClick={() => logout.mutate()} disabled={logout.isPending}>
                {logout.isPending ? 'Signing out…' : 'Logout'}
              </button>
            </>
          )}
        </div>
      </aside>
      <main className={`w-full min-w-0 px-4 py-6 sm:px-6 lg:min-h-screen lg:flex-1 lg:px-8 lg:py-8 2xl:px-12 min-[1920px]:px-16 ${collapsed ? 'lg:ml-16' : 'lg:ml-60'}`} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
