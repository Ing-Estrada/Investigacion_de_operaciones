'use client';

import { Check, Route, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Alert, Button, Field } from '@/components/common/ui';
import { useRegister } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api/client';

/**
 * Requisitos de contraseña, replicados del backend para dar feedback inmediato.
 *
 * Esta comprobación es de usabilidad, no de seguridad: el backend valida de nuevo con
 * las mismas reglas y es el único que decide. Nunca se confía en la validación del
 * cliente, que cualquiera puede saltarse con una petición directa.
 */
const PASSWORD_RULES = [
  { label: 'Al menos 12 caracteres', test: (value: string) => value.length >= 12 },
  { label: 'Una letra minúscula', test: (value: string) => /[a-z]/.test(value) },
  { label: 'Una letra mayúscula', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'Un dígito', test: (value: string) => /\d/.test(value) },
  { label: 'Un carácter especial', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

export default function RegisterPage() {
  const register = useRegister();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const ruleResults = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, passed: rule.test(form.password) })),
    [form.password],
  );

  const passwordValid = ruleResults.every((rule) => rule.passed);
  const passwordsMatch = form.password === form.confirmPassword;
  const canSubmit = passwordValid && passwordsMatch && form.email && form.firstName && form.lastName;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    register.mutate({
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
    });
  };

  const error = register.error;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 rounded-xl bg-accent p-2.5 text-accent-contrast">
            <Route className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Crear cuenta</h1>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Nombre"
              name="firstName"
              autoComplete="given-name"
              required
              value={form.firstName}
              onChange={update('firstName')}
            />
            <Field
              label="Apellidos"
              name="lastName"
              autoComplete="family-name"
              required
              value={form.lastName}
              onChange={update('lastName')}
            />
          </div>

          <Field
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={update('email')}
          />

          <Field
            label="Contraseña"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={update('password')}
          />

          {form.password.length > 0 && (
            <ul className="space-y-1" aria-label="Requisitos de la contraseña">
              {ruleResults.map((rule) => (
                <li key={rule.label} className="flex items-center gap-2 text-xs">
                  {rule.passed ? (
                    <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-content-muted" aria-hidden="true" />
                  )}
                  <span className={rule.passed ? 'text-success' : 'text-content-muted'}>
                    {rule.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Field
            label="Confirmar contraseña"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            error={
              form.confirmPassword && !passwordsMatch ? 'Las contraseñas no coinciden.' : undefined
            }
          />

          {error && (
            <Alert tone="danger">
              {error instanceof ApiError && error.status === 409
                ? 'No se pudo completar el registro con esos datos.'
                : error instanceof ApiError && error.isRateLimited
                  ? 'Demasiados registros desde esta conexión. Inténtalo más tarde.'
                  : 'No se pudo completar el registro. Revisa los datos e inténtalo de nuevo.'}
            </Alert>
          )}

          <Button
            type="submit"
            loading={register.isPending}
            disabled={!canSubmit}
            className="w-full"
          >
            Crear cuenta
          </Button>

          <p className="text-center text-sm text-content-muted">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
