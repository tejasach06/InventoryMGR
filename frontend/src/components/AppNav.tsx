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

function IconStorage() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="8" cy="3.5" rx="6" ry="2" /><path d="M2 3.5v9c0 1.1 2.7 2 6 2s6-.9 6-2v-9" /><path d="M2 8c0 1.1 2.7 2 6 2s6-.9 6-2" />
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

// Role-gated primary navigation. Dashboard and Reports are context (see OVERVIEW_ITEMS)
// and are shown to everyone, so they are not part of the role-gated set.
export function buildNavItems(user: Pick<User, 'role'>): NavItem[] {
  return [
    { to: '/inventory', label: 'Inventory', visible: true, icon: <IconGrid /> },
    { to: '/storage', label: 'Storage', visible: true, icon: <IconStorage /> },
    { to: '/imports/new', label: 'Import', visible: user.role === 'admin' || user.role === 'editor', icon: <IconUpload /> },
    { to: '/settings', label: 'Settings', visible: canSeeUsers(user.role), icon: <IconGear /> },
  ];
}

const OVERVIEW_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', visible: true, icon: <IconDashboard /> },
  { to: '/reports', label: 'Reports', visible: true, icon: <IconReport /> },
];

function NavLink({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  return (
    <Link
      href={item.to}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center rounded-lg text-sm font-medium transition-colors duration-150',
        collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2',
        active
          ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-500/12 dark:text-indigo-300'
          : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-white',
      )}
    >
      {active && !collapsed ? (
        <span aria-hidden="true" className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-indigo-500" />
      ) : null}
      {item.icon}
      {!collapsed && item.label}
    </Link>
  );
}

function GroupLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  if (collapsed) return <div aria-hidden="true" className="mx-auto my-2 h-px w-6 bg-slate-200 dark:bg-slate-800" />;
  return <p className="px-3 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{children}</p>;
}

export function AppNav({ user, collapsed = false }: { user: Pick<User, 'role'>; collapsed?: boolean }) {
  const pathname = usePathname();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const primary = buildNavItems(user).filter((item) => item.visible);

  return (
    <nav className="mt-4 flex flex-col gap-0.5 lg:mt-5" aria-label="Primary">
      <GroupLabel collapsed={collapsed}>Overview</GroupLabel>
      {OVERVIEW_ITEMS.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} active={isActive(item.to)} />
      ))}
      <GroupLabel collapsed={collapsed}>Manage</GroupLabel>
      {primary.map((item) => (
        <NavLink key={item.to} item={item} collapsed={collapsed} active={isActive(item.to)} />
      ))}
    </nav>
  );
}
