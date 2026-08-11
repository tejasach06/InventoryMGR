'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { auth as authApi } from '../../api/auth';
import { CurrentUserProvider } from '../../components/AuthContext';
import { AppLayout } from '../../components/Layout';
import { Logo, Skeleton } from '../../components/ui';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: authApi.me });


  useEffect(() => {
    // Redirect to login if user is not authenticated (error) or if query succeeded but returned no user
    if (me.isError || (!me.isLoading && !me.data)) {
      router.replace('/login');
    }
  }, [me.data, me.isError, me.isLoading, router]);
  const user = me.data;
  
  if (me.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--color-surface-secondary)] p-4 sm:p-8" role="status" aria-label="Loading session">
        <div className="mx-auto flex max-w-6xl gap-8">
          <div className="hidden w-56 space-y-5 lg:block"><Logo /><Skeleton className="h-8 w-full" /><Skeleton className="h-40 w-full" /></div>
          <div className="flex-1 space-y-6"><Skeleton className="h-12 w-64 max-w-full" /><Skeleton className="h-36 w-full" /><Skeleton className="h-72 w-full" /></div>
        </div>
      </div>
    );
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
