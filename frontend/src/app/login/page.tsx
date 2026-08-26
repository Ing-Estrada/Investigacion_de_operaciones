'use client';

import { Route } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Alert, Button, Field } from '@/components/common/ui';
import { useLogin } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api/client';

export default function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  const error = login.error;
  const isLocked = error instanceof ApiError && error.status === 403;
  const isRateLimited = error instanceof ApiError && error.isRateLimited;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 rounded-xl bg-accent p-2.5 text-accent-contrast">
            <Route className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Optimizador de Rutas</h1>
          <p className="mt-1 text-sm text-content-muted">Accede con tus credenciales</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6" noValidate>
          <Field
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="operador@example.com"
          />

          <Field
            label="Contraseña"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && (
            <Alert tone={isRateLimited ? 'warning' : 'danger'}>
              {isRateLimited
                ? 'Demasiados intentos. Espera un minuto antes de volver a probar.'
                : isLocked
                  ? 'La cuenta está bloqueada temporalmente por intentos fallidos.'
                  : 'Correo o contraseña incorrectos.'}
            </Alert>
          )}

          <Button type="submit" loading={login.isPending} className="w-full">
            Iniciar sesión
          </Button>

          <p className="text-center text-sm text-content-muted">
            ¿No tienes cuenta?{' '}
            <Link href="/register" className="font-medium text-accent hover:underline">
              Regístrate
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
