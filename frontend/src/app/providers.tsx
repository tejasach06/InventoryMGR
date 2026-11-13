'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { ApiError } from '../api/core';
import { AccentProvider } from '../components/AccentProvider';
import { ThemeProvider } from '../components/ThemeProvider';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => {
      const onError = (error: Error) => {
        if (error instanceof ApiError && error.status === 401) {
          client.setQueryData(['me'], null);
        }
      };
      const client = new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 30_000,
          },
        },
      });
      return client;
    },
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AccentProvider>{children}</AccentProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
