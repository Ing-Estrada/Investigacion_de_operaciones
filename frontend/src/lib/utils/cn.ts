import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases condicionales y resuelve los conflictos de Tailwind.
 *
 * `clsx` sola dejaría `px-2 px-4` en el DOM y ganaría la que Tailwind ordenase en el CSS,
 * no la última escrita. `twMerge` se queda con la última, que es lo que espera quien
 * pasa una clase por props para sobrescribir el estilo por defecto de un componente.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
