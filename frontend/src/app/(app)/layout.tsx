'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { auth as authApi } from '../../api/auth';
import { ApiError } from '../../api/core';
import { CurrentUserProvider } from '../../components/AuthContext';
import { AppLayout } from '../../components/Layout';
import { Alert, Logo, secondaryButtonClass, Skeleton } from '../../components/ui';
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: authApi.me });


  const unauthenticated = me.isError
    ? me.error instanceof ApiError && me.error.status === 401
    : !me.isLoading && !me.data;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);
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
  
  if (unauthenticated) return null;

  if (me.isError) {
    return (
      <div className="min-h-[100dvh] bg-[var(--color-surface-secondary)] p-4 sm:p-8">
        <div className="mx-auto max-w-md space-y-4">
          <Alert tone="error">
            <div className="space-y-2">
              <p>Could not load your session.</p>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => me.refetch()}
              >
                Retry
              </button>
            </div>
          </Alert>
        </div>
      </div>
    );
  }

  if (!user) return null;
  return (
    <CurrentUserProvider user={user}>
      <AppLayout user={user}>{children}</AppLayout>
    </CurrentUserProvider>
  );
}
