'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError } from '@/lib/api/client';

export function Providers({ children }: { children: React.ReactNode }) {
  // El QueryClient se crea en estado y no como constante de módulo: en SSR una
  // constante de módulo se comparte entre peticiones de usuarios distintos y filtraría
  // la caché de uno a otro.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Un 4xx no mejora reintentando: la petición es incorrecta o no está
              // autorizada. Y reintentar un 429 solo agrava el problema.
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
