import { buildSupportNoteContent } from '../support/support-routing.js';
import type { LeadData, ServiceData, SupportData, SupportMatchResult } from '../types/index.js';

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
  if (!phone || !phone.trim()) return undefined;
  const compact = phone.replace(/\s+/g, '');
  if (compact.startsWith('0')) {
    return compact.replace(/^0/, '0049');
  }
  if (compact.startsWith('+49')) {
    return compact.replace(/^\+49/, '0049');
  }
  return compact;
}

function normalizeEmail(email?: string): string | undefined {
  return email && email.trim() ? email.toLowerCase().trim() : undefined;
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
  return new Date().toISOString().slice(0, 10);
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

  async function searchPerson(term: string, fields: 'email' | 'phone'): Promise<number | undefined> {
    const result = await apiGet<{ items?: Array<{ item?: { id: number } }> }>('/persons/search', {
      term,
      fields,
      exact_match: 'true',
    });
    return result.items?.[0]?.item?.id;
  }

  function normalizeFullName(name?: string): string {
    return name ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  }

  async function searchPeople(term: string, fields: 'name' | 'email' | 'phone'): Promise<number[]> {
    const result = await apiGet<{ items?: Array<{ item?: { id: number; name?: string } }> }>('/persons/search', {
      term,
      fields,
      exact_match: 'true',
    });
    return (result.items ?? [])
      .map((entry) => entry.item?.id)
      .filter((id): id is number => typeof id === 'number');
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

    const dedupedIdentifierDeals = [...new Map(identifierDealMatches.map((deal) => [deal.id, deal])).values()];
    const candidateIdentifierDeals = candidateSet.size > 0
      ? dedupedIdentifierDeals.filter((deal) => {
        const personId = getDealPersonId(deal);
        return typeof personId === 'number' && candidateSet.has(personId);
      })
      : dedupedIdentifierDeals;
    const uniqueIdentifierDeal = uniqueCandidate(candidateIdentifierDeals.filter(isOpenDeal));
    if (uniqueIdentifierDeal) {
      return matchFromDeal(uniqueIdentifierDeal);
    }
    if (candidateIdentifierDeals.length > 1) {
      return { matchState: 'ambiguous', candidateCount: candidateIdentifierDeals.length };
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
    if (phone) {
      recentlyResolvedPersonIds.set(`phone:${phone}`, personId);
    }
  }

  async function findExistingPerson(email: string | undefined, phone: string | undefined): Promise<number | undefined> {
    if (email) {
      const cachedPersonId = recentlyResolvedPersonIds.get(`email:${email}`);
      if (cachedPersonId) return cachedPersonId;
    }
    if (phone) {
      const cachedPhonePersonId = recentlyResolvedPersonIds.get(`phone:${phone}`);
      if (cachedPhonePersonId) return cachedPhonePersonId;
    }

    if (email) {
      const personId = await searchPerson(email, 'email');
      if (personId) {
        cachePersonId(personId, email, phone);
        return personId;
      }
    }
    if (phone) {
      const personId = await searchPerson(phone, 'phone');
      if (personId) {
        cachePersonId(personId, email, phone);
      }
      return personId;
    }
    return undefined;
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

  async function createLead(data: LeadData): Promise<{ personId: number; dealId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const firstName = capitalize(data.firstName);
    const lastName = capitalize(data.lastName);
    const phone = normalizePhoneNumber(data.phone);
    const email = normalizeEmail(data.email);
    const street = capitalize(data.street);
    const postalCode = normalizePostalCode(data.postalCode);
    const city = capitalize(data.city);

    const existingPersonId = await findExistingPerson(email, phone);
    const personId = existingPersonId ?? (await createPerson(data, firstName, lastName, phone, email, street, postalCode, city)).id;
    cachePersonId(personId, email, phone);
    if (existingPersonId) {
      await updatePerson(existingPersonId, data, firstName, lastName, phone, email, street, postalCode, city);
    }

    const dealNotes = [
      `Erreichbarkeit: ${data.availability}`,
      data.message ? `Nachricht: ${data.message}` : '',
    ].filter(Boolean).join('\n');

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

    if (dealNotes) {
      // Only store values without dedicated Pipedrive fields as note content.
      await apiCall('/notes', {
        deal_id: deal.id,
        content: dealNotes,
        pinned_to_deal_flag: 1,
      }).catch(() => {}); // non-critical
    }

    return { personId, dealId: deal.id };
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

  async function createSupportNote(personId: number, data: SupportData, dealId?: number): Promise<{ noteId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const note = await apiCall('/notes', {
      person_id: personId,
      ...(dealId ? { deal_id: dealId, pinned_to_deal_flag: 1 } : {}),
      content: buildSupportNoteContent(data, 'unique'),
      pinned_to_person_flag: 1,
    });

    return { noteId: note.id };
  }

  return {
    isConfigured: () => configured,
    createLead,
    createServiceActivity,
    resolveSupportPerson,
    createSupportNote,
  };
}

export type PipedriveService = ReturnType<typeof createPipedriveService>;
