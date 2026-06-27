'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { User } from '../api/client';
import { cn } from '../lib/classNames';

export interface NavItem {
  to: string;
  label: string;
  visible: boolean;
  icon: ReactNode;
}

export function canSeeUsers(role: User['role'] | undefined): boolean {
  return role === 'admin';
}

function IconGrid() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V2m0 0L5 5m3-3 3 3" /><path d="M2 10v2.5a1.5 1.5 0 001.5 1.5h9a1.5 1.5 0 001.5-1.5V10" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconDashboard() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 8.5h5M2 12h5M9 4.5h5M9 8.5h5" /><rect x="1.5" y="2" width="5" height="3.5" rx="1" />
    </svg>
  );
}

function IconReport() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" /><path d="M5 5.5h6M5 8h6M5 10.5h4" />
    </svg>
  );
}

export function buildNavItems(user: Pick<User, 'role'>): NavItem[] {
  return [
    { to: '/dashboard', label: 'Dashboard', visible: true, icon: <IconDashboard /> },
    { to: '/inventory', label: 'Inventory', visible: true, icon: <IconGrid /> },
    { to: '/reports', label: 'Reports', visible: true, icon: <IconReport /> },
    { to: '/imports/new', label: 'Import', visible: user.role === 'admin' || user.role === 'editor', icon: <IconUpload /> },
    { to: '/settings', label: 'Settings', visible: canSeeUsers(user.role), icon: <IconGear /> },
  ];
}

export function AppNav({ user, collapsed = false }: { user: Pick<User, 'role'>; collapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={cn('mt-4 flex gap-1 overflow-x-auto lg:mt-6 lg:flex-col lg:overflow-visible', collapsed && 'lg:items-center')} aria-label="Primary">
      {buildNavItems(user)
        .filter((item) => item.visible)
        .map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              href={item.to}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5',
                active
                  ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                  : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white',
              )}
            >
              {item.icon}
              {!collapsed && item.label}
            </Link>
          );
        })}
    </nav>
  );
}
