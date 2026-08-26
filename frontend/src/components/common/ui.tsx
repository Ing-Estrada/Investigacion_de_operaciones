'use client';

import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils/cn';

// --- Spinner ----------------------------------------------------------------

export function LoadingSpinner({
  className,
  label = 'Cargando',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// --- Botón ------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn bg-danger text-white hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // Un botón en curso se deshabilita: sin esto, un doble clic en "Calcular ruta"
      // lanza dos optimizaciones y consume el doble de cuota de los proveedores.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(VARIANT_CLASSES[variant], className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

// --- Campo de formulario ----------------------------------------------------

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, className, ...props },
  ref,
) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, '-');
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div>
      <label htmlFor={inputId} className="label">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn('input', error && 'border-danger focus:border-danger focus:ring-danger', className)}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-content-muted">
          {hint}
        </p>
      )}
    </div>
  );
});

// --- Alerta -----------------------------------------------------------------

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-accent/40 bg-accent/10 text-content',
  success: 'border-success/40 bg-success/10 text-content',
  warning: 'border-warning/40 bg-warning/10 text-content',
  danger: 'border-danger/40 bg-danger/10 text-content',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      // `role="alert"` solo en los tonos que exigen atención inmediata: aplicarlo a todo
      // haría que los lectores de pantalla interrumpieran al usuario por cada aviso.
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-3 py-2 text-sm', TONE_CLASSES[tone], className)}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'text-content-muted')}>{children}</div>}
    </div>
  );
}

// --- Etiqueta ---------------------------------------------------------------

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-surface text-content-muted border-border',
    accent: 'bg-accent/10 text-accent border-accent/30',
    success: 'bg-success/10 text-success border-success/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// --- Métrica ----------------------------------------------------------------

export function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-content-muted">
        {icon}
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-content">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-content-muted">{hint}</p>}
    </div>
  );
}

// --- Estado vacío -----------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-content">{title}</p>
      {description && <p className="max-w-md text-sm text-content-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
