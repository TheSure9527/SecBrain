import * as chrono from 'chrono-node'

export function str(input: unknown, fallback = ''): string {
  return typeof input === 'string' ? input : fallback
}

export function bool(input: unknown, fallback = false): boolean {
  return typeof input === 'boolean' ? input : fallback
}
