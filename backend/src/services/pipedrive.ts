import { resolveSupportCategory } from '../support/support-routing.js';
import { buildPipedriveTranscriptMarker } from '../chat/transcript.js';
import { formatBerlinDate } from '../time/berlin.js';
import type { LeadCrmResult, LeadData, ServiceData, SupportData, SupportMatchResult } from '../types/index.js';

const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1';
const STEPHANIE_KREUZBUSCH_USER_ID = 24093350;

const dealFieldKeys = {
  stairLocation: 'aff4a71d003cb374585aeef67732b05828b62050',
  stairType: '36241991692b59873ce73c478b98aab6ad4054c1',
  buildingType: '9c08a82b8cad15eab222f89a6a961c59bc8c95e3',
  liftType: '684a7860061d276f4a76498fd1653d721e37cb6f',
  customerSegment: '59745cb0d3eb04f89e70543d01f49813175ad6a3',
  requestDate: 'eaf2557e218e842227f803c4abdc665291c99b91',
  channel: '300c5e3ef98a1a25e2f80262af2bd0942b95c231',
} as const;

const personFieldKeys = {
  address: '2f068d0e83a4ea944b6f91f97769a45557b62425',
  marketingOptIn: 'fd1928c889e5888dd2b7964ab9f2d8c129d1aa40',
  optInChannel: 'e0cb479c4f405997f2e53b58ddc84ecb6d4c7b49',
  role: '43c2a08a7993307990ced6639183ca91f7608b2b',
} as const;

const defaultDealCustomFields = {
  [dealFieldKeys.channel]: 177, // Inbound HP "Sarah"
} as const;

const defaultPersonCustomFields = {
  [personFieldKeys.optInChannel]: 140, // Kontaktformular
  [personFieldKeys.role]: '152', // Wirtschaftlicher Entscheider
} as const;

const liftTypeMappings: Record<NonNullable<LeadData['liftType']>, number> = {
  rollstuhlgeeignet: 125,
  sitzlift: 128,
};

const customerSegmentMappings: Record<NonNullable<LeadData['customerSegment']>, number> = {
  privatperson: 56,
  firma: 57,
};

const buildingTypeMappings: Record<NonNullable<LeadData['buildingType']>, number> = {
  einfamilienhaus: 122,
  mehrfamilienhaus: 123,
};

const stairTypeMappings: Record<NonNullable<LeadData['stairType']>, number> = {
  kurvig: 120,
  gerade: 121,
};

const stairLocationMappings: Record<NonNullable<LeadData['stairLocation']>, number> = {
  aussen: 119,
  innen: 118,
};

const optionAliases = {
  stairLocation: {
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
  },
  stairType: {
    kurvig: 'kurvig',
    gerade: 'gerade',
  },
  buildingType: {
    einfamilienhaus: 'einfamilienhaus',
    mehrfamilienhaus: 'mehrfamilienhaus',
  },
  liftType: {
    rollstuhlgeeignet: 'rollstuhlgeeignet',
    rollstuhl: 'rollstuhlgeeignet',
    plattformlift: 'rollstuhlgeeignet',
    sitzlift: 'sitzlift',
  },
  customerSegment: {
    privatperson: 'privatperson',
    privat: 'privatperson',
    privateperson: 'privatperson',
    firma: 'firma',
    firmenkunde: 'firma',
    firmenkundin: 'firma',
    geschaeftskunde: 'firma',
    geschäftskunde: 'firma',
    b2b: 'firma',
    unternehmen: 'firma',
  },
} as const;

function normalizeOptionValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function normalizePhoneNumber(phone?: string): string | undefined {
  const key = normalizeGermanPhoneKey(phone);
  return key ? `00${key}` : undefined;
}

function normalizeGermanPhoneKey(phone?: string): string | undefined {
  if (!phone || !phone.trim()) return undefined;
  let digits = phone.replace(/\D/g, '');
  let hadCountryCode = false;
  if (digits.startsWith('0049')) {
    digits = digits.slice(4);
    hadCountryCode = true;
  } else if (digits.startsWith('49')) {
    digits = digits.slice(2);
    hadCountryCode = true;
  }
  if (digits.startsWith('0') && (hadCountryCode || phone.trim().startsWith('0'))) {
    digits = digits.slice(1);
  }
  return digits ? `49${digits}` : undefined;
}

function normalizeEmail(email?: string): string | undefined {
  return email && email.trim() ? email.toLowerCase().trim() : undefined;
}

function normalizeComparableText(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeNameTokens(value?: string): string[] {
  const withoutTitles = normalizeComparableText(value)
    .replace(/\b(?:dr|prof|herr|frau)\b/g, ' ')
    .trim();
  return withoutTitles ? [...new Set(withoutTitles.split(/\s+/))].sort() : [];
}

function nameTokensMatch(candidateName: string | undefined, submittedName: string): boolean {
  const candidateTokens = new Set(normalizeNameTokens(candidateName));
  const submittedTokens = normalizeNameTokens(submittedName);
  return submittedTokens.length >= 2 && submittedTokens.every((token) => candidateTokens.has(token));
}

function capitalize(value?: string): string {
  if (!value || !value.trim()) return 'nicht ausgefüllt';
  return value.trim().charAt(0).toUpperCase() + value.trim().slice(1).toLowerCase();
}

function normalizePostalCode(postalCode?: string): string {
  if (!postalCode) return 'nicht ausgefüllt';
  const trimmed = postalCode.toString().trim();
  return /^\d+$/.test(trimmed) ? trimmed : 'nicht ausgefüllt';
}

function today(): string {
  return formatBerlinDate();
}

function buildAddress(street: string, postalCode: string, city: string): string | undefined {
  if (street === 'nicht ausgefüllt') return undefined;
  const locality = [postalCode, city].filter((part) => part !== 'nicht ausgefüllt').join(' ');
  return [street, locality].filter(Boolean).join(', ');
}

function buildPersonCustomFields(data: LeadData, street: string, postalCode: string, city: string): Record<string, number | string> {
  const customFields: Record<string, number | string> = { ...defaultPersonCustomFields };
  const address = buildAddress(street, postalCode, city);

  if (address) {
    customFields[personFieldKeys.address] = address;
  }
  if (data.newsletter === 'Ja') {
    customFields[personFieldKeys.marketingOptIn] = 138;
  } else if (data.newsletter === 'Nein') {
    customFields[personFieldKeys.marketingOptIn] = 139;
  }

  return customFields;
}

function buildDealCustomFields(data: LeadData): Record<string, number> {
  const customFields: Record<string, number> = { ...defaultDealCustomFields };
  const customerSegment = optionAliases.customerSegment[normalizeOptionValue(data.customerSegment) as keyof typeof optionAliases.customerSegment];
  if (customerSegment && customerSegmentMappings[customerSegment]) {
    customFields[dealFieldKeys.customerSegment] = customerSegmentMappings[customerSegment];
  }
  const stairLocation = optionAliases.stairLocation[normalizeOptionValue(data.stairLocation) as keyof typeof optionAliases.stairLocation];
  const stairType = optionAliases.stairType[normalizeOptionValue(data.stairType) as keyof typeof optionAliases.stairType];
  const buildingType = optionAliases.buildingType[normalizeOptionValue(data.buildingType) as keyof typeof optionAliases.buildingType];
  const liftType = optionAliases.liftType[normalizeOptionValue(data.liftType) as keyof typeof optionAliases.liftType];

  if (stairLocation && stairLocationMappings[stairLocation]) {
    customFields[dealFieldKeys.stairLocation] = stairLocationMappings[stairLocation];
  }
  if (stairType && stairTypeMappings[stairType]) {
    customFields[dealFieldKeys.stairType] = stairTypeMappings[stairType];
  }
  if (buildingType && buildingTypeMappings[buildingType]) {
    customFields[dealFieldKeys.buildingType] = buildingTypeMappings[buildingType];
  }
  if (liftType && liftTypeMappings[liftType]) {
    customFields[dealFieldKeys.liftType] = liftTypeMappings[liftType];
  }

  return customFields;
}

export function createPipedriveService(apiKey: string, pipelineId: number, stageId: number) {
  const configured = apiKey.length > 0;
  const recentlyResolvedPersonIds = new Map<string, number>();

  async function apiCall(endpoint: string, body: Record<string, unknown>, method = 'POST'): Promise<{ id: number }> {
    const response = await fetch(`${PIPEDRIVE_API_BASE}${endpoint}?api_token=${apiKey}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Pipedrive API error: ${response.status} ${response.statusText}`);
    }
    const result = await response.json() as { success: boolean; data: { id: number } };
    if (!result.success) {
      throw new Error('Pipedrive API returned success: false');
    }
    return result.data;
  }

  async function apiGet<T>(endpoint: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const searchParams = new URLSearchParams({ api_token: apiKey });
    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, String(value));
    }
    const response = await fetch(`${PIPEDRIVE_API_BASE}${endpoint}?${searchParams.toString()}`);
    if (!response.ok) {
      throw new Error(`Pipedrive API error: ${response.status} ${response.statusText}`);
    }
    const result = await response.json() as { success: boolean; data: T };
    if (!result.success) {
      throw new Error('Pipedrive API returned success: false');
    }
    return result.data;
  }

  function normalizeFullName(name?: string): string {
    return name ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  }

  type PersonSearchItem = { id: number; name?: string };

  async function searchPersonItems(
    term: string,
    fields: 'name' | 'email' | 'phone',
    exactMatch = true,
  ): Promise<PersonSearchItem[]> {
    const result = await apiGet<{ items?: Array<{ item?: PersonSearchItem }> }>('/persons/search', {
      term,
      fields,
      exact_match: exactMatch,
    });
    return (result.items ?? [])
      .map((entry) => entry.item)
      .filter((item): item is PersonSearchItem => typeof item?.id === 'number');
  }

  async function searchPeople(term: string, fields: 'name' | 'email' | 'phone'): Promise<number[]> {
    return (await searchPersonItems(term, fields)).map((item) => item.id);
  }

  type DealSearchItem = {
    id: number;
    status?: string;
    person?: { id?: number; name?: string } | null;
  };

  type PersonDeal = {
    id: number;
    status?: string;
    person_id?: { value?: number } | number;
  };

  function isDealSearchItem(deal: DealSearchItem | PersonDeal): deal is DealSearchItem {
    return 'person' in deal;
  }

  function getDealPersonId(deal: DealSearchItem | PersonDeal): number | undefined {
    if (isDealSearchItem(deal)) return deal.person?.id;
    if (typeof deal.person_id === 'number') return deal.person_id;
    return deal.person_id?.value;
  }

  function isOpenDeal(deal: DealSearchItem | PersonDeal): boolean {
    return !deal.status || deal.status === 'open';
  }

  function uniqueCandidate<T>(items: T[]): T | undefined {
    return items.length === 1 ? items[0] : undefined;
  }

  async function searchDeals(term: string, fields: 'custom_fields' | 'title'): Promise<DealSearchItem[]> {
    if (term.trim().length < 2) return [];
    const result = await apiGet<{ items?: Array<{ item?: DealSearchItem }> }>('/deals/search', {
      term: term.trim(),
      fields,
      exact_match: fields === 'custom_fields' ? 'true' : 'false',
    });
    return (result.items ?? [])
      .map((entry) => entry.item)
      .filter((deal): deal is DealSearchItem => typeof deal?.id === 'number');
  }

  async function getOpenPersonDeals(personId: number): Promise<PersonDeal[]> {
    const deals = await apiGet<PersonDeal[]>(`/persons/${personId}/deals`, { status: 'open' });
    return (deals ?? []).filter(isOpenDeal);
  }

  function supportIdentifiers(data: SupportData): string[] {
    const values = [
      data.priorContactReference,
      data.customerNumber,
      data.invoiceNumber,
      data.orderNumber,
      data.offerNumber,
      data.leadId,
      data.contractReference,
      data.paymentReference,
      data.sparePartReference,
    ];
    return [...new Set(values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length >= 2))];
  }

  function leadReferences(data: LeadData): string[] {
    return [...new Set([data.priorContactReference]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length >= 2))];
  }

  type LeadReferenceResolution =
    | { status: 'none' }
    | { status: 'unique'; personId: number; dealId: number }
    | { status: 'ambiguous'; candidateCount: number; reason: string };

  async function resolveLeadReference(data: LeadData): Promise<LeadReferenceResolution> {
    const matches: DealSearchItem[] = [];
    for (const reference of leadReferences(data)) {
      matches.push(...await searchDeals(reference, 'custom_fields'));
    }

    const openDeals = [...new Map(matches.map((deal) => [deal.id, deal])).values()]
      .filter(isOpenDeal);
    if (openDeals.length === 0) return { status: 'none' };
    if (openDeals.length > 1) {
      return {
        status: 'ambiguous',
        candidateCount: openDeals.length,
        reason: 'ambiguous_case_reference',
      };
    }

    const personId = getDealPersonId(openDeals[0]);
    if (!personId) {
      return {
        status: 'ambiguous',
        candidateCount: 1,
        reason: 'reference_deal_without_person',
      };
    }
    return { status: 'unique', personId, dealId: openDeals[0].id };
  }

  function matchFromDeal(deal: DealSearchItem): SupportMatchResult {
    const personId = getDealPersonId(deal);
    return personId
      ? { matchState: 'unique', personId, dealId: deal.id, candidateCount: 1 }
      : { matchState: 'unresolved', dealId: deal.id, candidateCount: 1 };
  }

  async function resolveSupportDeal(data: SupportData, candidatePersonIds: number[] = []): Promise<SupportMatchResult | undefined> {
    const candidateSet = new Set(candidatePersonIds);
    const identifierDealMatches: DealSearchItem[] = [];
    for (const identifier of supportIdentifiers(data)) {
      identifierDealMatches.push(...await searchDeals(identifier, 'custom_fields'));
    }

    const openIdentifierDeals = [...new Map(identifierDealMatches.map((deal) => [deal.id, deal])).values()]
      .filter(isOpenDeal);
    if (openIdentifierDeals.length > 1) {
      return { matchState: 'ambiguous', candidateCount: openIdentifierDeals.length };
    }
    if (openIdentifierDeals.length === 1) {
      const deal = openIdentifierDeals[0];
      const personId = getDealPersonId(deal);
      if (!personId) return { matchState: 'ambiguous', candidateCount: 1 };
      if (candidateSet.size > 0 && !candidateSet.has(personId)) {
        return { matchState: 'ambiguous', candidateCount: candidateSet.size + 1 };
      }
      return matchFromDeal(deal);
    }

    const uniquePersonId = uniqueCandidate(candidatePersonIds);
    if (uniquePersonId) {
      const uniqueOpenDeal = uniqueCandidate(await getOpenPersonDeals(uniquePersonId));
      if (uniqueOpenDeal) {
        return { matchState: 'unique', personId: uniquePersonId, dealId: uniqueOpenDeal.id, candidateCount: 1 };
      }
    }

    return undefined;
  }

  function resolveCandidateIntersection(nameMatches: number[], disambiguationMatches: number[]): SupportMatchResult {
    const candidateIds = new Set(nameMatches);
    const matchingCandidates = disambiguationMatches.filter((personId) => candidateIds.has(personId));
    if (matchingCandidates.length === 1) {
      return { matchState: 'unique', personId: matchingCandidates[0], candidateCount: 1 };
    }
    if (matchingCandidates.length > 1) {
      return { matchState: 'ambiguous', candidateCount: matchingCandidates.length };
    }
    return { matchState: 'unresolved', candidateCount: 0 };
  }

  type LeadIdentityResolution =
    | { status: 'none' }
    | { status: 'unique'; personId: number }
    | { status: 'ambiguous'; candidateCount: number; reason: string };

  function cachedPersonId(field: 'email' | 'phone', value: string): number | undefined {
    return recentlyResolvedPersonIds.get(`${field}:${value}`);
  }

  function addressCorroborates(person: Record<string, unknown>, data: LeadData): boolean {
    const storedAddress = person[personFieldKeys.address];
    if (typeof storedAddress !== 'string' || !storedAddress.trim()) return false;

    const stored = normalizeComparableText(storedAddress);
    const postalCode = data.postalCode?.trim();
    if (postalCode && new RegExp(`\\b${postalCode.replace(/[^0-9]/g, '')}\\b`).test(stored)) {
      return true;
    }

    const addressTokens = normalizeComparableText([data.street, data.city].filter(Boolean).join(' '))
      .split(/\s+/)
      .filter((token) => token.length >= 2);
    return addressTokens.length >= 2 && addressTokens.every((token) => stored.includes(token));
  }

  async function resolveLeadNameFallback(data: LeadData): Promise<LeadIdentityResolution> {
    const submittedName = [data.firstName, data.lastName].filter(Boolean).join(' ').trim();
    if (normalizeNameTokens(submittedName).length < 2) return { status: 'none' };

    const searchItems = await searchPersonItems(submittedName, 'name', false);
    const nameCandidates = searchItems.filter((item) => nameTokensMatch(item.name, submittedName));
    if (nameCandidates.length === 0) return { status: 'none' };

    const corroboratedIds: number[] = [];
    for (const candidate of nameCandidates) {
      const person = await apiGet<Record<string, unknown>>(`/persons/${candidate.id}`);
      if (addressCorroborates(person, data)) corroboratedIds.push(candidate.id);
    }

    const uniqueIds = [...new Set(corroboratedIds)];
    if (uniqueIds.length === 1) return { status: 'unique', personId: uniqueIds[0] };
    if (uniqueIds.length > 1) {
      return {
        status: 'ambiguous',
        candidateCount: uniqueIds.length,
        reason: 'ambiguous_name_and_address',
      };
    }
    return {
      status: 'ambiguous',
      candidateCount: nameCandidates.length,
      reason: 'name_match_requires_corroboration',
    };
  }

  async function resolveLeadIdentity(data: LeadData): Promise<LeadIdentityResolution> {
    const email = normalizeEmail(data.email);
    const phoneKey = normalizeGermanPhoneKey(data.phone);
    const phoneSearchValue = normalizePhoneNumber(data.phone);
    const matchSets: number[][] = [];

    if (email) {
      const matches = await searchPeople(email, 'email');
      const cached = cachedPersonId('email', email);
      matchSets.push([...new Set(matches.length > 0 ? matches : cached ? [cached] : [])]);
    }

    if (phoneKey && phoneSearchValue) {
      const matches = await searchPeople(phoneSearchValue, 'phone');
      const cached = cachedPersonId('phone', phoneKey);
      matchSets.push([...new Set(matches.length > 0 ? matches : cached ? [cached] : [])]);
    }

    const nonEmptySets = matchSets.filter((matches) => matches.length > 0);
    if (nonEmptySets.length === 0) {
      return resolveLeadNameFallback(data);
    }

    const intersection = nonEmptySets.slice(1).reduce(
      (candidateIds, matches) => new Set([...candidateIds].filter((id) => matches.includes(id))),
      new Set(nonEmptySets[0]),
    );
    if (intersection.size === 1) {
      return { status: 'unique', personId: [...intersection][0] };
    }
    if (intersection.size > 1) {
      return {
        status: 'ambiguous',
        candidateCount: intersection.size,
        reason: 'ambiguous_contact_identifier',
      };
    }

    const candidates = new Set(nonEmptySets.flat());
    if (nonEmptySets.length > 1) {
      return {
        status: 'ambiguous',
        candidateCount: candidates.size,
        reason: 'conflicting_contact_identifiers',
      };
    }

    return {
      status: 'ambiguous',
      candidateCount: candidates.size,
      reason: 'ambiguous_contact_identifier',
    };
  }

  async function resolveSupportPerson(data: SupportData): Promise<SupportMatchResult> {
    if (!configured) throw new Error('Pipedrive not configured');

    const normalizedName = normalizeFullName(data.customerName);
    if (!normalizedName) {
      const dealMatch = await resolveSupportDeal(data);
      return dealMatch ?? { matchState: 'unresolved', candidateCount: 0 };
    }

    const nameMatches = await searchPeople(normalizedName, 'name');
    if (nameMatches.length === 1) {
      const dealMatch = await resolveSupportDeal(data, nameMatches);
      return dealMatch ?? { matchState: 'unique', personId: nameMatches[0], candidateCount: 1 };
    }

    const email = normalizeEmail(data.email);
    const phone = data.phone?.trim() ? normalizePhoneNumber(data.phone) : undefined;

    if (nameMatches.length > 1 && !email && !phone) {
      return { matchState: 'ambiguous', candidateCount: nameMatches.length };
    }

    if (email) {
      const emailMatches = await searchPeople(email, 'email');
      if (nameMatches.length > 1) {
        const candidateMatch = resolveCandidateIntersection(nameMatches, emailMatches);
        if (candidateMatch.matchState === 'unique' && candidateMatch.personId) {
          const dealMatch = await resolveSupportDeal(data, [candidateMatch.personId]);
          return dealMatch ?? candidateMatch;
        }
        return candidateMatch;
      }
      const dealMatch = await resolveSupportDeal(data, emailMatches);
      if (dealMatch) return dealMatch;
      return emailMatches.length === 1
        ? { matchState: 'unique', personId: emailMatches[0], candidateCount: 1 }
        : { matchState: 'unresolved', candidateCount: emailMatches.length };
    }

    if (phone) {
      const phoneMatches = await searchPeople(phone, 'phone');
      if (nameMatches.length > 1) {
        const candidateMatch = resolveCandidateIntersection(nameMatches, phoneMatches);
        if (candidateMatch.matchState === 'unique' && candidateMatch.personId) {
          const dealMatch = await resolveSupportDeal(data, [candidateMatch.personId]);
          return dealMatch ?? candidateMatch;
        }
        return candidateMatch;
      }
      const dealMatch = await resolveSupportDeal(data, phoneMatches);
      if (dealMatch) return dealMatch;
      return phoneMatches.length === 1
        ? { matchState: 'unique', personId: phoneMatches[0], candidateCount: 1 }
        : { matchState: 'unresolved', candidateCount: phoneMatches.length };
    }

    const dealMatch = await resolveSupportDeal(data, nameMatches);
    if (dealMatch) return dealMatch;

    return { matchState: 'unresolved', candidateCount: nameMatches.length };
  }

  function cachePersonId(personId: number, email: string | undefined, phone: string | undefined): void {
    if (email) {
      recentlyResolvedPersonIds.set(`email:${email}`, personId);
    }
    const phoneKey = normalizeGermanPhoneKey(phone);
    if (phoneKey) {
      recentlyResolvedPersonIds.set(`phone:${phoneKey}`, personId);
    }
  }

  function buildPersonPayload(data: LeadData, firstName: string, lastName: string, phone: string | undefined, email: string | undefined, street: string, postalCode: string, city: string): Record<string, unknown> {
    return {
      name: `${firstName} ${lastName}`,
      owner_id: STEPHANIE_KREUZBUSCH_USER_ID,
      ...(phone ? { phone: [{ value: phone, primary: true }] } : {}),
      ...(email ? { email: [{ value: email, primary: true }] } : {}),
      ...buildPersonCustomFields(data, street, postalCode, city),
    };
  }

  async function createPerson(data: LeadData, firstName: string, lastName: string, phone: string | undefined, email: string | undefined, street: string, postalCode: string, city: string): Promise<{ id: number }> {
    return apiCall('/persons', buildPersonPayload(data, firstName, lastName, phone, email, street, postalCode, city));
  }

  async function updatePerson(personId: number, data: LeadData, firstName: string, lastName: string, phone: string | undefined, email: string | undefined, street: string, postalCode: string, city: string): Promise<void> {
    await apiCall(`/persons/${personId}`, buildPersonPayload(data, firstName, lastName, phone, email, street, postalCode, city), 'PUT');
  }

  async function createLead(data: LeadData): Promise<LeadCrmResult> {
    if (!configured) throw new Error('Pipedrive not configured');

    const firstName = capitalize(data.firstName);
    const lastName = capitalize(data.lastName);
    const phone = normalizePhoneNumber(data.phone);
    const email = normalizeEmail(data.email);
    const street = capitalize(data.street);
    const postalCode = normalizePostalCode(data.postalCode);
    const city = capitalize(data.city);

    const reference = await resolveLeadReference(data);
    if (reference.status === 'ambiguous') {
      return {
        outcome: 'identity_review',
        candidateCount: reference.candidateCount,
        reason: reference.reason,
      };
    }

    const identity = await resolveLeadIdentity(data);
    const isNameOnlyAmbiguity = identity.status === 'ambiguous'
      && (identity.reason === 'name_match_requires_corroboration'
        || identity.reason === 'ambiguous_name_and_address');
    if (identity.status === 'ambiguous' && !(reference.status === 'unique' && isNameOnlyAmbiguity)) {
      return {
        outcome: 'identity_review',
        candidateCount: identity.candidateCount,
        reason: identity.reason,
      };
    }

    if (reference.status === 'unique') {
      if (identity.status === 'unique' && identity.personId !== reference.personId) {
        return {
          outcome: 'identity_review',
          candidateCount: 2,
          reason: 'reference_contact_conflict',
        };
      }

      await updatePerson(reference.personId, data, firstName, lastName, phone, email, street, postalCode, city);
      cachePersonId(reference.personId, email, phone);
      return {
        outcome: 'reused',
        personId: reference.personId,
        dealId: reference.dealId,
        createdPerson: false,
      };
    }

    const existingPersonId = identity.status === 'unique' ? identity.personId : undefined;
    const personId = existingPersonId ?? (await createPerson(data, firstName, lastName, phone, email, street, postalCode, city)).id;
    cachePersonId(personId, email, phone);

    if (existingPersonId) {
      const openDeals = await getOpenPersonDeals(existingPersonId);
      if (openDeals.length > 1) {
        return {
          outcome: 'person_review',
          personId: existingPersonId,
          createdPerson: false,
          candidateCount: openDeals.length,
          reason: 'multiple_open_deals',
        };
      }

      await updatePerson(existingPersonId, data, firstName, lastName, phone, email, street, postalCode, city);
      if (openDeals.length === 1) {
        return {
          outcome: 'reused',
          personId: existingPersonId,
          dealId: openDeals[0].id,
          createdPerson: false,
        };
      }
    }

    const deal = await apiCall('/deals', {
      title: `Sarah Lead: ${firstName} ${lastName}`,
      person_id: personId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      visible_to: 3,
      user_id: STEPHANIE_KREUZBUSCH_USER_ID,
      [dealFieldKeys.requestDate]: today(),
      ...buildDealCustomFields(data),
    });

    return { outcome: 'created', personId, dealId: deal.id, createdPerson: !existingPersonId };
  }

  async function createServiceActivity(data: ServiceData): Promise<{ personId: number; activityId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const person = await apiCall('/persons', {
      name: data.customerName,
      ...(data.phone ? { phone: [{ value: data.phone, primary: true }] } : {}),
      ...(data.email ? { email: [{ value: data.email, primary: true }] } : {}),
    });

    const activity = await apiCall('/activities', {
      subject: `Service-Anfrage: ${data.issueDescription!.substring(0, 80)}`,
      type: 'task',
      note: [
        `Problembeschreibung: ${data.issueDescription}`,
        data.liftModel ? `Lift-Modell: ${data.liftModel}` : '',
      ].filter(Boolean).join('\n'),
      person_id: person.id,
      done: 0,
    });

    return { personId: person.id, activityId: activity.id };
  }

  async function createSupportCase(
    data: SupportData,
    match: SupportMatchResult,
  ): Promise<{ personId: number; dealId: number; createdPerson: boolean }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const customerName = data.customerName?.trim() || 'Unbekannter Kunde';
    const email = normalizeEmail(data.email);
    const phone = normalizePhoneNumber(data.phone);
    const phoneKey = normalizeGermanPhoneKey(data.phone);
    const cachedSupportPersonId = match.personId
      ? undefined
      : (email ? cachedPersonId('email', email) : undefined)
        ?? (phoneKey ? cachedPersonId('phone', phoneKey) : undefined);
    const createdPerson = !match.personId && !cachedSupportPersonId;
    const personId = match.personId ?? cachedSupportPersonId ?? (await apiCall('/persons', {
      name: customerName,
      owner_id: STEPHANIE_KREUZBUSCH_USER_ID,
      ...(phone ? { phone: [{ value: phone, primary: true }] } : {}),
      ...(email ? { email: [{ value: email, primary: true }] } : {}),
      ...defaultPersonCustomFields,
    })).id;
    cachePersonId(personId, email, data.phone);

    const category = resolveSupportCategory(data);
    const reviewSuffix = match.matchState === 'unique' ? '' : ' – Zuordnung prüfen';
    const deal = await apiCall('/deals', {
      title: `Sarah Support [${category}]: ${customerName}${reviewSuffix}`,
      person_id: personId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      visible_to: 3,
      user_id: STEPHANIE_KREUZBUSCH_USER_ID,
      [dealFieldKeys.requestDate]: today(),
      ...defaultDealCustomFields,
    });

    return { personId, dealId: deal.id, createdPerson };
  }

  async function createChatTranscriptNote(
    sessionId: string,
    personId: number,
    dealId: number | undefined,
    content: string,
  ): Promise<{ noteId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const marker = buildPipedriveTranscriptMarker(sessionId);
    const existingNotes = (await apiGet<Array<{ id: number; content?: string }> | null>('/notes', {
      ...(dealId ? { deal_id: dealId } : { person_id: personId }),
      limit: 500,
    })) ?? [];
    const existingNote = existingNotes.find((note) => note.content?.includes(marker));
    if (existingNote) return { noteId: existingNote.id };

    const note = await apiCall('/notes', {
      person_id: personId,
      ...(dealId ? { deal_id: dealId, pinned_to_deal_flag: 1 } : {}),
      content,
      pinned_to_person_flag: 1,
    });

    return { noteId: note.id };
  }

  return {
    isConfigured: () => configured,
    createLead,
    createServiceActivity,
    createSupportCase,
    resolveSupportPerson,
    createChatTranscriptNote,
  };
}

export type PipedriveService = ReturnType<typeof createPipedriveService>;
