import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge our custom text-* sizes so they don't get confused with text colours.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['overline', 'display', 'h1', 'h2', 'h3'] }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
