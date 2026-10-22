import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose class names. clsx handles the conditionals, tailwind-merge resolves
 * conflicts so a caller's `px-6` reliably beats a component's default `px-4`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
