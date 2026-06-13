import { Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, User } from '../api/client';
import { AppNav } from './AppNav';
interface LayoutProps {
  user: User;
}

export function AppLayout({ user }: LayoutProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">InventoryMGR</div>
        <AppNav user={user} />
        <div className="sidebar-footer">
          <div className="current-user">
            <span>{user.email}</span>
            <strong>{user.role}</strong>
          </div>
          <button type="button" className="secondary full-width" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {logout.isPending ? 'Signing out…' : 'Logout'}
          </button>
        </div>
      </aside>
      <main className="content" tabIndex={-1}>
        <Outlet context={{ user }} />
      </main>
    </div>
  );
}
