import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins class names and lets the last conflicting utility win, so a caller can
 * override a component's default padding or colour without `!important`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
