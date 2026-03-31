import type { LeadData, ServiceData } from '../types/index.js';

const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1';

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

    const person = await apiCall('/persons', {
      name: `${data.firstName} ${data.lastName}`,
      phone: [{ value: data.phone, primary: true }],
      ...(data.email ? { email: [{ value: data.email, primary: true }] } : {}),
    });

    const dealNotes = [
      `Treppe: ${data.stairLocation || 'k.A.'}`,
      `Verlauf: ${data.stairType || 'k.A.'}`,
      `Gebäude: ${data.buildingType || 'k.A.'}`,
      `Lifttyp: ${data.liftType || 'k.A.'}`,
      `Adresse: ${data.street || ''} ${data.postalCode} ${data.city}`.trim(),
      `Erreichbarkeit: ${data.availability}`,
      data.message ? `Nachricht: ${data.message}` : '',
      `Newsletter: ${data.newsletter || 'k.A.'}`,
    ].filter(Boolean).join('\n');

    const deal = await apiCall('/deals', {
      title: `Sarah Lead: ${data.firstName} ${data.lastName}`,
      person_id: person.id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      visible_to: 3,
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
