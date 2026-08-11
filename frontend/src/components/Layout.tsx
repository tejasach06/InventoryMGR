'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode, useCallback, useRef, useState } from 'react';
import { auth as authApi } from '../api/auth';
import type { User } from '../api/types';
import { Logo, secondaryButtonClass } from './ui';
import { AppNav } from './AppNav';
import { ThemeSelect, ThemeSegmented } from './ThemeProvider';
import { useAccentSync } from './AccentProvider';
import { NotificationBell } from './NotificationBell';
import { useModalOverlay } from '../hooks/useModalOverlay';

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useModalOverlay({ open: mobileOpen, onClose: closeMobile, containerRef: mobilePanelRef, initialFocusRef: mobileCloseRef });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  return (
    <div className="min-h-[100dvh] bg-[var(--color-surface-secondary)] lg:flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-[var(--color-border)] focus:bg-[var(--color-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--color-text-primary)] focus:shadow-[var(--shadow-overlay)]">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 flex h-[var(--app-header-h)] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="font-display text-base font-semibold tracking-tight">Inventory<span className="text-[var(--color-accent-text)]">MGR</span></span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
            <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
          </button>
        </div>
      </header>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-[var(--color-scrim)] backdrop-blur-sm" onClick={closeMobile} aria-hidden="true" />
          <div ref={mobilePanelRef} className="relative flex h-full w-[min(22rem,88vw)] flex-col overflow-y-auto bg-[var(--color-surface)] p-5 shadow-[var(--shadow-overlay)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4">
              <div className="flex items-center gap-2.5"><Logo /><span className="font-display font-semibold">InventoryMGR</span></div>
              <button ref={mobileCloseRef} type="button" onClick={closeMobile} aria-label="Close navigation" className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]">×</button>
            </div>
            <AppNav user={user} onNavigate={closeMobile} />
            <div className="mt-auto space-y-4 border-t border-[var(--color-border-subtle)] pt-4">
              <div className="flex items-center gap-3">
                <UserAvatarInitial email={user.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{user.email}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{user.role}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <ThemeSegmented />
                <button
                  type="button"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  aria-label="Logout"
                  title={logout.isPending ? 'Signing out…' : 'Logout'}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogoutIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <aside id="primary-nav" className={`hidden bg-[var(--color-surface)] lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:flex-col lg:border-r lg:border-[var(--color-border)] lg:py-6 ${collapsed ? 'lg:w-16 lg:px-3' : 'lg:w-60 lg:px-5'}`} aria-label="Primary navigation">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 min-w-0 w-full lg:block">
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'lg:flex-col lg:justify-center lg:w-full lg:gap-3' : 'justify-between'}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Logo className="h-8 w-8 flex-shrink-0" />
              {!collapsed && <span className="truncate font-display text-[1.05rem] font-semibold tracking-tight text-[var(--color-text-primary)] min-w-0">Inventory<span className="text-[var(--color-accent-text)]">MGR</span></span>}
            </div>
            <NotificationBell />
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
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <UserAvatarInitial email={user.email} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{user.email}</span>
                  <span className="block text-xs text-[var(--color-text-tertiary)]">{user.role}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <ThemeSegmented />
                <button
                  type="button"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  aria-label="Logout"
                  title={logout.isPending ? 'Signing out…' : 'Logout'}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-criticality-critical-bg)] hover:text-[var(--color-criticality-critical)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogoutIcon />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <ThemeSegmented direction="col" />
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
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="primary-nav"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={`fixed top-1/2 z-30 hidden h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-tertiary)] shadow-[var(--shadow-raised)] transition-colors duration-150 hover:bg-[var(--color-surface-tertiary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-secondary)] lg:inline-flex ${collapsed ? 'lg:left-16' : 'lg:left-60'}`}
      >
        <svg className={`h-3.5 w-3.5 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 4L6 8l4 4" />
        </svg>
      </button>
      <main id="main-content" className={`w-full min-w-0 px-4 py-6 sm:px-6 lg:min-h-[100dvh] lg:flex-1 lg:px-8 lg:py-8 2xl:px-12 min-[1920px]:px-16 ${collapsed ? 'lg:ml-16' : 'lg:ml-60'}`} tabIndex={-1}>
        <div className="mx-auto w-full max-w-[100rem]">{children}</div>
      </main>
    </div>
  );
}
