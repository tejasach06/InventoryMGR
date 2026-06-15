'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { api } from '../../api/client';
import { CurrentUserProvider } from '../../components/AuthContext';
import { AppLayout } from '../../components/Layout';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  useEffect(() => {
    if (me.isError || (!me.isLoading && !me.data)) {
      router.replace('/login');
    }
  }, [me.data, me.isError, me.isLoading, router]);

  if (me.isLoading) {
    return <div className="p-6" role="status">Loading session…</div>;
  }

  if (me.isError || !me.data) {
    return <div className="p-6" role="status">Redirecting…</div>;
  }

  return (
    <CurrentUserProvider user={me.data}>
      <AppLayout user={me.data}>{children}</AppLayout>
    </CurrentUserProvider>
  );
}
