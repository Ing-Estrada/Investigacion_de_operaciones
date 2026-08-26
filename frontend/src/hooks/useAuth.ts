'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { ApiError } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';
import type { UserProfile } from '@/lib/types/api.types';

export const CURRENT_USER_KEY = ['auth', 'me'] as const;

/**
 * Sesión actual.
 *
 * La fuente de verdad es `GET /auth/me`, no el token: el access token va en una cookie
 * httpOnly que el JavaScript no puede leer, así que la única forma de saber si hay
 * sesión —y con qué rol— es preguntárselo al servidor. Además evita confiar en un
 * estado de cliente que podría estar obsoleto tras un cambio de rol.
 */
export function useCurrentUser() {
  return useQuery<UserProfile | null>({
    queryKey: CURRENT_USER_KEY,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (error) {
        // 401 no es un fallo: significa "no hay sesión", que es una respuesta válida.
        if (error instanceof ApiError && error.isUnauthorized) return null;
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (response) => {
      queryClient.setQueryData(CURRENT_USER_KEY, response.user);
      router.push('/dashboard');
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (response) => {
      queryClient.setQueryData(CURRENT_USER_KEY, response.user);
      router.push('/dashboard');
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      // Se limpia siempre, incluso si la petición falló: la intención del usuario es
      // cerrar sesión, y dejar datos de otra cuenta en caché sería peor que un error.
      queryClient.clear();
      router.push('/login');
    },
  });
}
