import type { LeadData } from '../types/index.js';

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, '');
  return normalized || undefined;
}

const stairLocationAliases: Record<string, NonNullable<LeadData['stairLocation']>> = {
  außentreppe: 'aussen',
  aussentreppe: 'aussen',
  außen: 'aussen',
  aussen: 'aussen',
  draußen: 'aussen',
  draussen: 'aussen',
  aussenbereich: 'aussen',
  außenbereich: 'aussen',
  innentreppe: 'innen',
  innen: 'innen',
  drinnen: 'innen',
  innenbereich: 'innen',
};

const stairTypeAliases: Record<string, NonNullable<LeadData['stairType']>> = {
  kurvig: 'kurvig',
  gerade: 'gerade',
  keine_treppe: 'keine_treppe',
  keinetreppe: 'keine_treppe',
  ohnetreppe: 'keine_treppe',
  nichtzutreffend: 'keine_treppe',
};

const buildingTypeAliases: Record<string, NonNullable<LeadData['buildingType']>> = {
  einfamilienhaus: 'einfamilienhaus',
  mehrfamilienhaus: 'mehrfamilienhaus',
};

const liftTypeAliases: Record<string, NonNullable<LeadData['liftType']>> = {
  rollstuhlgeeignet: 'rollstuhlgeeignet',
  rollstuhl: 'rollstuhlgeeignet',
  plattformlift: 'rollstuhlgeeignet',
  sitzlift: 'sitzlift',
};

function resolveAlias<T extends string>(
  aliases: Record<string, T>,
  value: unknown,
): T | undefined {
  const token = normalizeToken(value);
  return token ? aliases[token] : undefined;
}

export function normalizeStairLocation(
  value: unknown,
): NonNullable<LeadData['stairLocation']> | undefined {
  return resolveAlias(stairLocationAliases, value);
}

export function normalizeStairType(
  value: unknown,
): NonNullable<LeadData['stairType']> | undefined {
  return resolveAlias(stairTypeAliases, value);
}

export function normalizeBuildingType(
  value: unknown,
): NonNullable<LeadData['buildingType']> | undefined {
  return resolveAlias(buildingTypeAliases, value);
}

export function normalizeLiftType(
  value: unknown,
): NonNullable<LeadData['liftType']> | undefined {
  return resolveAlias(liftTypeAliases, value);
}

export function stairLocationLabel(value: unknown): string | undefined {
  const normalized = normalizeStairLocation(value);
  if (normalized === 'innen') return 'Innentreppe';
  if (normalized === 'aussen') return 'Außentreppe';
  return undefined;
}

export function stairTypeLabel(value: unknown): string | undefined {
  const normalized = normalizeStairType(value);
  if (normalized === 'gerade') return 'Gerade';
  if (normalized === 'kurvig') return 'Kurvig';
  if (normalized === 'keine_treppe') return 'Keine Treppe';
  return undefined;
}

export function buildingTypeLabel(value: unknown): string | undefined {
  const normalized = normalizeBuildingType(value);
  if (normalized === 'einfamilienhaus') return 'Einfamilienhaus';
  if (normalized === 'mehrfamilienhaus') return 'Mehrfamilienhaus';
  return undefined;
}

export function liftTypeLabel(value: unknown): string | undefined {
  const normalized = normalizeLiftType(value);
  if (normalized === 'sitzlift') return 'Sitzlift';
  if (normalized === 'rollstuhlgeeignet') return 'Rollstuhlgeeignet';
  return undefined;
}
