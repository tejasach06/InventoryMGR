'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode, useCallback, useState } from 'react';
import { api, User } from '../api/client';
import { Logo, secondaryButtonClass } from './ui';
import { AppNav } from './AppNav';
import { ThemeSelect, ThemeSegmented } from './ThemeProvider';
import { useAccentSync } from './AccentProvider';
import { NotificationBell } from './NotificationBell';

interface LayoutProps {
  user: User;
  children: ReactNode;
}

function LogoutIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6" />
      <path d="M10.5 11.5L14 8l-3.5-3.5" />
      <path d="M14 8H6" />
    </svg>
  );
}

function initialFromEmail(email: string): string {
  return (email.trim()[0] ?? '?').toUpperCase();
}

function UserAvatarInitial({ email }: { email: string }): ReactNode {
  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-tertiary)] text-sm font-semibold text-[var(--color-text-secondary)]" aria-hidden="true">
      {initialFromEmail(email)}
    </span>
  );
}
export function AppLayout({ user, children }: LayoutProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useAccentSync();
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
    <div className="min-h-screen bg-[var(--color-surface-secondary)] lg:flex">
      <NotificationBell />
      <aside className={`sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-4 backdrop-blur lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:border-b-0 lg:border-r lg:py-6 ${collapsed ? 'lg:w-16 lg:px-3' : 'lg:w-60 lg:px-5'}`} aria-label="Primary navigation">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 min-w-0 w-full lg:block">
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'lg:w-full lg:flex-col lg:items-center lg:gap-2' : ''}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)] lg:inline-flex"
            >
              <svg className={`h-4 w-4 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 4L6 8l4 4" />
              </svg>
            </button>
            <Logo className="h-8 w-8 flex-shrink-0" />
            {!collapsed && <span className="truncate font-display text-[1.05rem] font-semibold tracking-tight text-[var(--color-text-primary)] min-w-0">Inventory<span className="text-[var(--color-accent-text)]">MGR</span></span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full lg:hidden">
            <ThemeSelect />
            <button type="button" className={secondaryButtonClass} onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? 'Signing out…' : 'Logout'}
            </button>
          </div>
        </div>
        <AppNav user={user} collapsed={collapsed} />
        <div className={`mt-4 hidden pt-4 border-[var(--color-border-subtle)] lg:mt-auto lg:block ${collapsed ? '' : 'border-t'}`}>
          {!collapsed ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">Theme</span>
                <ThemeSegmented />
              </div>
              <div className="h-px w-full bg-[var(--color-border-subtle)]" />
              <div className="flex items-center gap-3">
                <UserAvatarInitial email={user.email} />
                <div className="min-w-0 flex-1 flex-col">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{user.email}</span>
                  <span className="mt-0.5 inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface-tertiary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">
                    {user.role}
                  </span>
                </div>
              </div>
              <div className="h-px w-full bg-[var(--color-border-subtle)]" />
              <button
                type="button"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-[var(--color-criticality-critical)] transition-colors hover:bg-[var(--color-criticality-critical-bg)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogoutIcon />
                <span>{logout.isPending ? 'Signing out…' : 'Logout'}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <ThemeSegmented direction="col" />
              <div className="h-px w-8 bg-[var(--color-border-subtle)]" />
              <UserAvatarInitial email={user.email} />
              <button
                type="button"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                aria-label="Logout"
                title="Logout"
                className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-criticality-critical)] transition-colors hover:bg-[var(--color-criticality-critical-bg)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogoutIcon />
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className={`w-full min-w-0 px-4 py-6 sm:px-6 lg:min-h-screen lg:flex-1 lg:px-8 lg:py-8 2xl:px-12 min-[1920px]:px-16 ${collapsed ? 'lg:ml-16' : 'lg:ml-60'}`} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
