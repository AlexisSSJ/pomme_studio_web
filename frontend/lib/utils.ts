import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases de Tailwind resolviendo conflictos.
 * Útil para componentes con variantes (class-variance-authority).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
