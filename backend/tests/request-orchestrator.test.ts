import { describe, expect, it, vi } from 'vitest';
import { createRequestJournal } from '../src/request/request-journal.js';
import { createRequestOrchestrator } from '../src/request/request-orchestrator.js';
import type { ConversationTracker, RequestCheckpoint } from '../src/services/conversation-tracking.js';

function durableJournal() {
  const store: RequestCheckpoint[] = [];
  const tracker: ConversationTracker = {
    isEnabled: () => true,
    ensureSession: async () => undefined,
    recordMessage: async () => undefined,
    recordEvent: async () => undefined,
    updateSession: async () => undefined,
    getRequestEvents: async (sessionId, requestId) => store.filter((event) => event.sessionId === sessionId && event.requestId === requestId),
    recordRequestCheckpoint: async (input) => {
      store.push({ sessionId: input.sessionId, requestId: input.requestId, step: input.step, payload: input.payload });
    },
  };
  return { journal: createRequestJournal(tracker), store };
}

function baseDependencies() {
  return {
    pipedrive: {
      createLead: vi.fn().mockResolvedValue({ outcome: 'created', personId: 11, dealId: 22, createdPerson: true }),
      resolveFactoryCase: vi.fn().mockResolvedValue({ matchState: 'unique', personId: 31, dealId: 41, factoryNumber: 'FN-42' }),
      createServiceRequest: vi.fn().mockResolvedValue({
        personId: 31, dealId: 51, noteId: 61, sourceDealId: 41, sourceDealUrl: 'https://pipedrive.test/deal/41', serviceDealUrl: 'https://pipedrive.test/deal/51', reused: false,
      }),
    },
    email: {
      sendLeadNotification: vi.fn().mockResolvedValue(undefined),
      sendSupportNotification: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('createRequestOrchestrator', () => {
  it('creates or reuses the opportunity before sending its email', async () => {
    const calls: string[] = [];
    const deps = baseDependencies();
    deps.pipedrive.createLead.mockImplementation(async () => { calls.push('crm'); return { outcome: 'created', personId: 11, dealId: 22, createdPerson: true }; });
    deps.email.sendLeadNotification.mockImplementation(async () => { calls.push('email'); });
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });

    const result = await orchestrator.execute({
      sessionId: 's1', requestId: 'r1', mode: 'anfrage', transcript: 'vollstaendig',
      leadData: { ownsLift: 'no', priorContact: 'no', firstName: 'Max', lastName: 'Muster', email: 'max@example.de' },
    });

    expect(calls).toEqual(['crm', 'email']);
    expect(deps.email.sendLeadNotification).toHaveBeenCalledWith('sales@lippelift.de', expect.any(Object), expect.objectContaining({ dealId: 22 }));
    expect(result).toMatchObject({ requestId: 'r1', kind: 'opportunity', completed: true, crm: { dealId: 22 } });
  });

  it.each([
    {
      label: 'third-party lift',
      data: { ownsLift: 'yes' as const, liftManufacturer: 'other' as const, serviceRequestType: 'technical' as const },
      recipient: 'technik@lippelift.de',
    },
    {
      label: 'LIPPE lift without factory number',
      data: { ownsLift: 'yes' as const, liftManufacturer: 'lippe' as const, factoryNumberStatus: 'unavailable' as const, serviceRequestType: 'invoice_payment' as const },
      recipient: 'finance@lippelift.de',
    },
  ])('uses email only for $label', async ({ data, recipient }) => {
    const deps = baseDependencies();
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });

    const result = await orchestrator.execute({
      sessionId: 's1', requestId: `r-${recipient}`, mode: 'service', transcript: 'vollstaendig',
      supportData: { ...data, customerName: 'Erika Muster', email: 'erika@example.de', category: data.serviceRequestType === 'invoice_payment' ? 'finance' : 'technik', issueDescription: 'Bitte pruefen.' },
    });

    expect(deps.pipedrive.resolveFactoryCase).not.toHaveBeenCalled();
    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(deps.email.sendSupportNotification).toHaveBeenCalledWith(recipient, expect.objectContaining({ intendedInbox: recipient }));
    expect(result).toMatchObject({ kind: 'service', completed: true, recipient });
    expect(result.crm).toBeUndefined();
  });

  it('keeps maintenance read-only but creates a Serviceanfrage for another exact LIPPE case', async () => {
    const deps = baseDependencies();
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });
    const base = {
      ownsLift: 'yes' as const,
      liftManufacturer: 'lippe' as const,
      factoryNumber: 'FN-42',
      factoryNumberStatus: 'provided' as const,
      customerName: 'Erika Muster',
      email: 'erika@example.de',
      category: 'technik' as const,
      issueDescription: 'Bitte pruefen.',
    };

    const maintenance = await orchestrator.execute({
      sessionId: 's1', requestId: 'r-maintenance', mode: 'service', transcript: 'wartung',
      supportData: { ...base, serviceRequestType: 'maintenance' },
    });
    const technical = await orchestrator.execute({
      sessionId: 's1', requestId: 'r-technical', mode: 'service', transcript: 'technik',
      supportData: { ...base, serviceRequestType: 'technical' },
    });

    expect(deps.pipedrive.resolveFactoryCase).toHaveBeenCalledTimes(2);
    expect(deps.pipedrive.createServiceRequest).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.createServiceRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r-technical' }));
    expect(maintenance.crm).toBeUndefined();
    expect(maintenance.sourceCase).toMatchObject({ dealId: 41 });
    expect(technical.crm).toMatchObject({ dealId: 51 });
  });

  it('retries only email after SMTP failure and never duplicates the Serviceanfrage', async () => {
    const deps = baseDependencies();
    deps.email.sendSupportNotification
      .mockRejectedValueOnce(new Error('smtp unavailable'))
      .mockResolvedValueOnce(undefined);
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });
    const input = {
      sessionId: 's1', requestId: 'r-retry', mode: 'service' as const, transcript: 'technik',
      supportData: {
        ownsLift: 'yes' as const, liftManufacturer: 'lippe' as const, factoryNumber: 'FN-42', factoryNumberStatus: 'provided' as const,
        serviceRequestType: 'technical' as const, customerName: 'Erika Muster', email: 'erika@example.de', category: 'technik' as const, issueDescription: 'Fehler',
      },
    };

    await expect(orchestrator.execute(input)).rejects.toThrow('smtp unavailable');
    await expect(orchestrator.execute(input)).resolves.toMatchObject({ completed: true, crm: { dealId: 51 } });
    expect(deps.pipedrive.resolveFactoryCase).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.createServiceRequest).toHaveBeenCalledTimes(1);
    expect(deps.email.sendSupportNotification).toHaveBeenCalledTimes(2);
  });
});
