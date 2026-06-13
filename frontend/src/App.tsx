import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { api, User } from './api/client';
import { AppLayout } from './components/Layout';
import { LoginPage } from './routes/LoginPage';
import { InventoryPage } from './routes/InventoryPage';
import { VmFormPage } from './routes/VmFormPage';
import { VmDetailPage } from './routes/VmDetailPage';
import { ImportCsvPage } from './routes/ImportCsvPage';
import { UsersPage } from './routes/UsersPage';
import { Alert } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

function RequireAuth() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  if (me.isLoading) {
    return <div className="loading" role="status">Loading session…</div>;
  }

  if (me.isError || !me.data) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout user={me.data} />;
}

function RequireAdmin({ user, children }: { user: User | undefined; children: ReactNode }) {
  if (user?.role !== 'admin') {
    return <Alert>You need an admin account to manage users.</Alert>;
  }
  return children;
}

function RequireEditor({ user, children }: { user: User | undefined; children: ReactNode }) {
  if (user?.role !== 'editor' && user?.role !== 'admin') {
    return <Alert>You need an editor or admin account to change VM inventory.</Alert>;
  }
  return children;
}

function UsersRoute() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  return <RequireAdmin user={me.data}><UsersPage /></RequireAdmin>;
}

function VmEditRoute({ mode }: { mode: 'create' | 'edit' }) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  return <RequireEditor user={me.data}><VmFormPage mode={mode} /></RequireEditor>;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Navigate to="/inventory" replace /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'inventory/new', element: <VmEditRoute mode="create" /> },
      { path: 'inventory/:id', element: <VmDetailPage /> },
      { path: 'inventory/:id/edit', element: <VmEditRoute mode="edit" /> },
      { path: 'imports/new', element: <ImportCsvPage /> },
      { path: 'users', element: <UsersRoute /> },
    ],
  },
  { path: '*', element: <Navigate to="/inventory" replace /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
