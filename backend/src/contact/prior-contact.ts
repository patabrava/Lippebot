import type { PriorContactStatus } from '../types/index.js';

const priorContactStatuses = new Set<PriorContactStatus>(['yes', 'no', 'unknown']);

export function hasPriorContactStatus(value: unknown): value is { priorContact: PriorContactStatus } {
  if (typeof value !== 'object' || value === null) return false;
  const priorContact = (value as { priorContact?: unknown }).priorContact;
  return typeof priorContact === 'string' && priorContactStatuses.has(priorContact as PriorContactStatus);
}
