import type { LeadData, ServiceData } from '../types/index.js';

const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1';

const dealFieldKeys = {
  stairLocation: 'aff4a71d003cb374585aeef67732b05828b62050',
  stairType: '36241991692b59873ce73c478b98aab6ad4054c1',
  buildingType: '9c08a82b8cad15eab222f89a6a961c59bc8c95e3',
  liftType: '684a7860061d276f4a76498fd1653d721e37cb6f',
} as const;

const liftTypeMappings: Record<NonNullable<LeadData['liftType']>, number> = {
  rollstuhlgeeignet: 125,
  sitzlift: 128,
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

function buildDealCustomFields(data: LeadData): Record<string, number> {
  const customFields: Record<string, number> = {};
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
