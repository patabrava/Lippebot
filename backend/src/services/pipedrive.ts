import type { LeadData, ServiceData } from '../types/index.js';

const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1';

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
    innentreppe: 'innen',
    innen: 'innen',
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
} as const;

function normalizeOptionValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function normalizePhoneNumber(phone?: string): string {
  if (!phone) return 'nicht ausgefüllt';
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
  if (data.customerSegment && customerSegmentMappings[data.customerSegment]) {
    customFields[dealFieldKeys.customerSegment] = customerSegmentMappings[data.customerSegment];
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

  async function apiCall(endpoint: string, body: Record<string, unknown>): Promise<{ id: number }> {
    const response = await fetch(`${PIPEDRIVE_API_BASE}${endpoint}?api_token=${apiKey}`, {
      method: 'POST',
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

  async function createLead(data: LeadData): Promise<{ personId: number; dealId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const firstName = capitalize(data.firstName);
    const lastName = capitalize(data.lastName);
    const phone = normalizePhoneNumber(data.phone);
    const email = normalizeEmail(data.email);
    const street = capitalize(data.street);
    const postalCode = normalizePostalCode(data.postalCode);
    const city = capitalize(data.city);

    const person = await apiCall('/persons', {
      name: `${firstName} ${lastName}`,
      phone: [{ value: phone, primary: true }],
      ...(email ? { email: [{ value: email, primary: true }] } : {}),
      ...buildPersonCustomFields(data, street, postalCode, city),
    });

    const dealNotes = [
      `Treppe: ${data.stairLocation || 'k.A.'}`,
      `Verlauf: ${data.stairType || 'k.A.'}`,
      `Gebäude: ${data.buildingType || 'k.A.'}`,
      `Lifttyp: ${data.liftType || 'k.A.'}`,
      `Adresse: ${street}, ${postalCode} ${city}`,
      `PLZ: ${postalCode}`,
      `Erreichbarkeit: ${data.availability}`,
      data.message ? `Nachricht: ${data.message}` : '',
      `Newsletter: ${data.newsletter || 'k.A.'}`,
    ].filter(Boolean).join('\n');

    const deal = await apiCall('/deals', {
      title: `Sarah Lead: ${firstName} ${lastName}`,
      person_id: person.id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      visible_to: 3,
      owner_id: 24093350,
      [dealFieldKeys.requestDate]: today(),
      ...buildDealCustomFields(data),
    });

    // Add note to deal
    await apiCall('/notes', {
      deal_id: deal.id,
      content: dealNotes,
      pinned_to_deal_flag: 1,
    }).catch(() => {}); // non-critical

    return { personId: person.id, dealId: deal.id };
  }

  async function createServiceActivity(data: ServiceData): Promise<{ personId: number; activityId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const person = await apiCall('/persons', {
      name: data.customerName,
      phone: [{ value: data.phone, primary: true }],
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

  return {
    isConfigured: () => configured,
    createLead,
    createServiceActivity,
  };
}

export type PipedriveService = ReturnType<typeof createPipedriveService>;
