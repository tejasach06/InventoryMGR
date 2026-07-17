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
    // Redirect to login if user is not authenticated (error) or if query succeeded but returned no user
    if (me.isError || (!me.isLoading && !me.data)) {
      router.replace('/login');
    }
  }, [me.data, me.isError, me.isLoading, router]);
  const user = me.data;
  
  // Show loading screen while fetching
  if (me.isLoading) {
    return <div className="p-6" role="status">Loading session…</div>;
  }
  
  // If user is not authenticated or data is missing, show redirecting message
  // (useEffect above handles the actual redirect)
  if (me.isError || !user) {
    return null;
  }

  return (
    <CurrentUserProvider user={user}>
      <AppLayout user={user}>{children}</AppLayout>
    </CurrentUserProvider>
  );
}
