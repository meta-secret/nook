import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

type NookClassNames = ClassValue[]

export function cn(...inputs: NookClassNames) {
  return twMerge(clsx(inputs))
}
