'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User } from '../api/client';
import { cn } from '../lib/classNames';

export interface NavItem {
  to: string;
  label: string;
  visible: boolean;
}

export function canSeeUsers(role: User['role'] | undefined): boolean {
  return role === 'admin';
}

export function buildNavItems(user: Pick<User, 'role'>): NavItem[] {
  return [
    { to: '/inventory', label: 'Inventory', visible: true },
    { to: '/imports/new', label: 'CSV Import', visible: user.role === 'admin' || user.role === 'editor' },
    { to: '/users', label: 'Users', visible: canSeeUsers(user.role) },
  ];
}

export function AppNav({ user }: { user: Pick<User, 'role'> }) {
  const pathname = usePathname();

  return (
    <nav className="mt-4 flex gap-2 overflow-x-auto lg:mt-8 lg:flex-col lg:overflow-visible" aria-label="Primary">
      {buildNavItems(user)
        .filter((item) => item.visible)
        .map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              href={item.to}
              className={cn(
                'rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
                active ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-slate-950' : 'text-slate-600 hover:-translate-y-0.5 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
              )}
            >
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
