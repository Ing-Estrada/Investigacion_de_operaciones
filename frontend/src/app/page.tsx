'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { LoadingSpinner } from '@/components/common/ui';
import { useCurrentUser } from '@/hooks/useAuth';

export default function HomePage() {
  const router = useRouter();
  const { data: user, isPending } = useCurrentUser();

  useEffect(() => {
    if (isPending) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [user, isPending, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <LoadingSpinner label="Comprobando la sesión" />
    </main>
  );
}
