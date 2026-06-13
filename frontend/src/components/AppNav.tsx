import { NavLink } from 'react-router-dom';
import { User } from '../api/client';

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
  return (
    <nav className="nav-list">
      {buildNavItems(user)
        .filter((item) => item.visible)
        .map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            {item.label}
          </NavLink>
        ))}
    </nav>
  );
}
