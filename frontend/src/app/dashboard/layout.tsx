'use client';

import { BarChart3, LogOut, Map, Receipt, Route as RouteIcon, Truck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Badge, LoadingSpinner } from '@/components/common/ui';
import { useCurrentUser, useLogout } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Planificador', icon: Map },
  { href: '/dashboard/routes', label: 'Rutas', icon: RouteIcon },
  { href: '/dashboard/vehicles', label: 'Vehículos', icon: Truck },
  { href: '/dashboard/tariffs', label: 'Tarifas', icon: Receipt },
  { href: '/dashboard/analytics', label: 'Analíticas', icon: BarChart3 },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user, isPending } = useCurrentUser();
  const logout = useLogout();

  useEffect(() => {
    // Esta comprobación es de navegación, no de seguridad: cada endpoint del backend
    // valida el JWT por su cuenta, así que quitarla del cliente no daría acceso a nada.
    if (!isPending && !user) router.replace('/login');
  }, [user, isPending, router]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner label="Cargando la sesión" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[500] border-b border-border bg-surface-raised/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="rounded-lg bg-accent p-1.5 text-accent-contrast">
              <RouteIcon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="hidden sm:inline">Optimizador de Rutas</span>
          </Link>

          <nav aria-label="Principal" className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              // Comparación exacta para el planificador: con `startsWith` se marcaría
              // como activo también en /dashboard/routes y en /dashboard/vehicles.
              const isActive =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-accent/10 font-medium text-accent'
                      : 'text-content-muted hover:bg-surface hover:text-content',
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">
                {user.firstName} {user.lastName}
              </p>
              <Badge tone="accent" className="mt-0.5">
                {ROLE_LABELS[user.role] ?? user.role}
              </Badge>
            </div>

            <button
              type="button"
              onClick={() => logout.mutate()}
              className="btn-ghost"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
