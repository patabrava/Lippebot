import { describe, expect, it, vi } from 'vitest';
import { createRequestJournal } from '../src/request/request-journal.js';
import { createRequestOrchestrator } from '../src/request/request-orchestrator.js';
import type { ConversationTracker, RequestCheckpoint } from '../src/services/conversation-tracking.js';

function durableJournal(store: RequestCheckpoint[] = []) {
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
      resolveSupportReferenceCase: vi.fn().mockResolvedValue({ matchState: 'unique', personId: 31, dealId: 45, candidateCount: 1 }),
      resolveSupportFollowUpCase: vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 }),
      createServiceRequest: vi.fn().mockResolvedValue({
        personId: 31, dealId: 51, noteId: 61, sourceDealId: 41, sourceDealUrl: 'https://pipedrive.test/deal/41', serviceDealUrl: 'https://pipedrive.test/deal/51', reused: false,
      }),
      appendServiceRequestToExistingCase: vi.fn().mockResolvedValue({
        personId: 31, dealId: 45, noteId: 62, sourceDealId: 41, sourceDealUrl: 'https://pipedrive.test/deal/41', serviceDealUrl: 'https://pipedrive.test/deal/45', reused: true,
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
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
      opportunityCopyRecipients: 'berg@lippelift.de,caechma@gmail.com',
    });

    const result = await orchestrator.execute({
      sessionId: 's1', requestId: 'r1', mode: 'anfrage', transcript: 'vollstaendig',
      leadData: { ownsLift: 'no', priorContact: 'no', firstName: 'Max', lastName: 'Muster', email: 'max@example.de' },
    });

    expect(calls).toEqual(['crm', 'email', 'email', 'email']);
    expect(deps.email.sendLeadNotification.mock.calls.map(([recipient]) => recipient)).toEqual([
      'sales@lippelift.de',
      'berg@lippelift.de',
      'caechma@gmail.com',
    ]);
    expect(deps.email.sendLeadNotification).toHaveBeenLastCalledWith(
      'caechma@gmail.com', expect.any(Object), expect.objectContaining({ dealId: 22 }),
    );
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
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
      serviceCopyRecipients: 'berg@lippelift.de,caechma@gmail.com',
    });

    const result = await orchestrator.execute({
      sessionId: 's1', requestId: `r-${recipient}`, mode: 'service', transcript: 'vollstaendig',
      supportData: { ...data, customerName: 'Erika Muster', email: 'erika@example.de', category: data.serviceRequestType === 'invoice_payment' ? 'finance' : 'technik', issueDescription: 'Bitte pruefen.' },
    });

    expect(deps.pipedrive.resolveFactoryCase).not.toHaveBeenCalled();
    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(deps.email.sendSupportNotification.mock.calls.map(([address]) => address)).toEqual([
      recipient,
      'berg@lippelift.de',
      'caechma@gmail.com',
    ]);
    expect(deps.email.sendSupportNotification).toHaveBeenLastCalledWith(
      'caechma@gmail.com', expect.objectContaining({ intendedInbox: recipient }),
    );
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

  it('routes separate-session prior-contact follow-ups to the same exact support case', async () => {
    const deps = baseDependencies();
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });
    const supportData = {
      ownsLift: 'yes' as const,
      liftManufacturer: 'lippe' as const,
      factoryNumber: 'FN-42',
      factoryNumberStatus: 'provided' as const,
      serviceRequestType: 'technical' as const,
      priorContact: 'yes' as const,
      priorContactReference: 'CASE-45',
      customerName: 'Erika Muster',
      email: 'erika@example.de',
      category: 'technik' as const,
      issueDescription: 'Folgefrage zum vorhandenen Vorgang.',
    };

    const first = await orchestrator.execute({
      sessionId: 'closed-session-one', requestId: 'follow-up-one', mode: 'service', transcript: 'erste Folgefrage', supportData,
    });
    const second = await orchestrator.execute({
      sessionId: 'new-session-two', requestId: 'follow-up-two', mode: 'service', transcript: 'zweite Folgefrage', supportData,
    });

    expect(deps.pipedrive.resolveFactoryCase).toHaveBeenCalledTimes(2);
    expect(deps.pipedrive.resolveSupportReferenceCase).toHaveBeenCalledTimes(2);
    expect(deps.pipedrive.appendServiceRequestToExistingCase).toHaveBeenCalledTimes(2);
    expect(deps.pipedrive.appendServiceRequestToExistingCase).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestId: 'follow-up-one',
      targetCase: { matchState: 'unique', personId: 31, dealId: 45, candidateCount: 1 },
    }));
    expect(deps.pipedrive.appendServiceRequestToExistingCase).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestId: 'follow-up-two',
      targetCase: { matchState: 'unique', personId: 31, dealId: 45, candidateCount: 1 },
    }));
    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(first.crm).toMatchObject({ dealId: 45, reused: true });
    expect(second.crm).toMatchObject({ dealId: 45, reused: true });
  });

  it('creates one support case then reuses it from a completely new session when the exact reference is not indexed', async () => {
    const deps = baseDependencies();
    deps.pipedrive.resolveSupportReferenceCase.mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    deps.pipedrive.resolveSupportFollowUpCase.mockResolvedValue({ matchState: 'unique', personId: 31, dealId: 51, candidateCount: 1 });
    deps.pipedrive.appendServiceRequestToExistingCase.mockImplementation(async ({ sourceCase, targetCase }) => ({
      personId: targetCase.personId,
      dealId: targetCase.dealId,
      noteId: 62,
      sourceDealId: sourceCase.dealId,
      sourceDealUrl: `https://pipedrive.test/deal/${sourceCase.dealId}`,
      serviceDealUrl: `https://pipedrive.test/deal/${targetCase.dealId}`,
      reused: true,
    }));
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });
    const base = {
      ownsLift: 'yes' as const,
      liftManufacturer: 'lippe' as const,
      factoryNumber: 'FN-42',
      factoryNumberStatus: 'provided' as const,
      serviceRequestType: 'technical' as const,
      customerName: 'Erika Muster',
      email: 'erika@example.de',
      category: 'technik' as const,
      issueDescription: 'Lift bleibt stehen.',
    };

    const first = await orchestrator.execute({
      sessionId: 'closed-initial-session', requestId: 'initial-support-request', mode: 'service', transcript: 'Erstanfrage',
      supportData: { ...base, priorContact: 'no' },
    });
    const second = await orchestrator.execute({
      sessionId: 'brand-new-follow-up-session', requestId: 'follow-up-support-request', mode: 'service', transcript: 'Folgeanfrage',
      supportData: { ...base, priorContact: 'yes', priorContactReference: 'NOT-YET-INDEXED' },
    });

    expect(deps.pipedrive.createServiceRequest).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.resolveSupportFollowUpCase).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'erika@example.de', priorContact: 'yes' }),
      { matchState: 'unique', personId: 31, dealId: 41, factoryNumber: 'FN-42' },
    );
    expect(deps.pipedrive.appendServiceRequestToExistingCase).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.appendServiceRequestToExistingCase).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'follow-up-support-request',
      targetCase: { matchState: 'unique', personId: 31, dealId: 51, candidateCount: 1 },
    }));
    expect(first.crm).toMatchObject({ dealId: 51, reused: false });
    expect(second.crm).toMatchObject({ dealId: 51, reused: true });
  });

  it('does not mutate support CRM when fallback identity or existing cases are ambiguous', async () => {
    const deps = baseDependencies();
    deps.pipedrive.resolveSupportReferenceCase.mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    deps.pipedrive.resolveSupportFollowUpCase.mockResolvedValue({ matchState: 'ambiguous', candidateCount: 2 });
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });

    const result = await orchestrator.execute({
      sessionId: 'ambiguous-follow-up-session', requestId: 'ambiguous-follow-up-request', mode: 'service', transcript: 'Folgeanfrage',
      supportData: {
        ownsLift: 'yes', liftManufacturer: 'lippe', factoryNumber: 'FN-42', factoryNumberStatus: 'provided',
        serviceRequestType: 'technical', priorContact: 'yes', customerName: 'Erika Muster',
        email: 'erika@example.de', category: 'technik', issueDescription: 'Lift bleibt stehen.',
      },
    });

    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(deps.pipedrive.appendServiceRequestToExistingCase).not.toHaveBeenCalled();
    expect(result.crm).toBeUndefined();
    expect(result.sourceCase).toEqual({ matchState: 'ambiguous', candidateCount: 2 });
  });

  it('does not create a duplicate support case when prior contact is yes but no existing case resolves', async () => {
    const deps = baseDependencies();
    deps.pipedrive.resolveSupportReferenceCase.mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    deps.pipedrive.resolveSupportFollowUpCase.mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 });
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });

    const result = await orchestrator.execute({
      sessionId: 'missing-follow-up-session', requestId: 'missing-follow-up-request', mode: 'service', transcript: 'Folgeanfrage',
      supportData: {
        ownsLift: 'yes', liftManufacturer: 'lippe', factoryNumber: 'FN-42', factoryNumberStatus: 'provided',
        serviceRequestType: 'technical', priorContact: 'yes', priorContactReference: 'UNKNOWN-CASE',
        customerName: 'Erika Muster', email: 'erika@example.de', category: 'technik', issueDescription: 'Lift bleibt stehen.',
      },
    });

    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(deps.pipedrive.appendServiceRequestToExistingCase).not.toHaveBeenCalled();
    expect(result.crm).toBeUndefined();
    expect(result.sourceCase).toEqual({ matchState: 'unresolved', candidateCount: 0 });
  });

  it('does not mutate CRM when prior-contact and factory identities conflict', async () => {
    const deps = baseDependencies();
    deps.pipedrive.resolveSupportReferenceCase.mockResolvedValue({ matchState: 'unique', personId: 99, dealId: 45, candidateCount: 1 });
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({ ...deps, journal, opportunityRecipient: 'sales@lippelift.de' });

    const result = await orchestrator.execute({
      sessionId: 'conflict-session', requestId: 'conflict-request', mode: 'service', transcript: 'Konflikt',
      supportData: {
        ownsLift: 'yes', liftManufacturer: 'lippe', factoryNumber: 'FN-42', factoryNumberStatus: 'provided',
        serviceRequestType: 'technical', priorContact: 'yes', priorContactReference: 'CASE-45',
        customerName: 'Andere Person', email: 'andere@example.de', category: 'technik', issueDescription: 'Test',
      },
    });

    expect(deps.pipedrive.appendServiceRequestToExistingCase).not.toHaveBeenCalled();
    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(result.crm).toBeUndefined();
    expect(result.sourceCase).toEqual({ matchState: 'ambiguous', candidateCount: 2 });
    expect(deps.email.sendSupportNotification).toHaveBeenCalledWith(
      'technik@lippelift.de',
      expect.objectContaining({ matchState: 'ambiguous', dealId: undefined }),
    );
  });

  it('does not repeat an existing-case append when SMTP resumes after a process restart', async () => {
    const deps = baseDependencies();
    deps.email.sendSupportNotification
      .mockRejectedValueOnce(new Error('smtp unavailable'))
      .mockResolvedValue(undefined);
    const { journal, store } = durableJournal();
    const input = {
      sessionId: 'support-restart-one', requestId: 'support-restart-request', mode: 'service' as const, transcript: 'Folgefrage',
      supportData: {
        ownsLift: 'yes' as const, liftManufacturer: 'lippe' as const, factoryNumber: 'FN-42', factoryNumberStatus: 'provided' as const,
        serviceRequestType: 'technical' as const, priorContact: 'yes' as const, priorContactReference: 'CASE-45',
        customerName: 'Erika Muster', email: 'erika@example.de', category: 'technik' as const, issueDescription: 'Test',
      },
    };
    const dependencies = { ...deps, opportunityRecipient: 'sales@lippelift.de' };

    await expect(createRequestOrchestrator({ ...dependencies, journal }).execute(input)).rejects.toThrow('smtp unavailable');
    await expect(createRequestOrchestrator({
      ...dependencies,
      journal: durableJournal(store).journal,
    }).execute(input)).resolves.toMatchObject({ completed: true, crm: { dealId: 45, reused: true } });

    expect(deps.pipedrive.resolveFactoryCase).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.resolveSupportReferenceCase).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.appendServiceRequestToExistingCase).toHaveBeenCalledTimes(1);
    expect(deps.email.sendSupportNotification).toHaveBeenCalledTimes(2);
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

  it('retries only the failed copy recipient without duplicating successful emails or CRM writes', async () => {
    const deps = baseDependencies();
    let caechmaAttempts = 0;
    deps.email.sendSupportNotification.mockImplementation(async (recipient) => {
      if (recipient === 'caechma@gmail.com' && caechmaAttempts++ === 0) {
        throw new Error('caechma SMTP unavailable');
      }
    });
    const { journal, store } = durableJournal();
    const dependencies = {
      ...deps,
      opportunityRecipient: 'sales@lippelift.de',
      serviceCopyRecipients: 'berg@lippelift.de,caechma@gmail.com',
    };
    const orchestrator = createRequestOrchestrator({ ...dependencies, journal });
    const input = {
      sessionId: 's-copy-retry', requestId: 'r-copy-retry', mode: 'service' as const, transcript: 'technik',
      supportData: {
        ownsLift: 'yes' as const, liftManufacturer: 'lippe' as const, factoryNumber: 'FN-42', factoryNumberStatus: 'provided' as const,
        serviceRequestType: 'technical' as const, customerName: 'Erika Muster', email: 'erika@example.de', category: 'technik' as const, issueDescription: 'Fehler',
      },
    };

    await expect(orchestrator.execute(input)).rejects.toThrow('caechma SMTP unavailable');
    const restartedOrchestrator = createRequestOrchestrator({
      ...dependencies,
      journal: durableJournal(store).journal,
    });
    await expect(restartedOrchestrator.execute(input)).resolves.toMatchObject({ completed: true, crm: { dealId: 51 } });

    expect(deps.pipedrive.resolveFactoryCase).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.createServiceRequest).toHaveBeenCalledTimes(1);
    expect(deps.email.sendSupportNotification.mock.calls.map(([recipient]) => recipient)).toEqual([
      'technik@lippelift.de',
      'berg@lippelift.de',
      'caechma@gmail.com',
      'caechma@gmail.com',
    ]);
  });

  it('backfills missing copies without resending the primary recipient from a legacy email checkpoint', async () => {
    const deps = baseDependencies();
    const store: RequestCheckpoint[] = [{
      sessionId: 's-legacy',
      requestId: 'r-legacy',
      step: 'email',
      payload: { sent: true, recipient: 'technik@lippelift.de' },
    }];
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal: durableJournal(store).journal,
      opportunityRecipient: 'sales@lippelift.de',
      serviceCopyRecipients: 'berg@lippelift.de,caechma@gmail.com',
    });

    await orchestrator.execute({
      sessionId: 's-legacy', requestId: 'r-legacy', mode: 'service', transcript: 'legacy',
      supportData: {
        ownsLift: 'yes', liftManufacturer: 'other', serviceRequestType: 'technical',
        customerName: 'Legacy Test', email: 'legacy@example.test', category: 'technik', issueDescription: 'Test',
      },
    });

    expect(deps.email.sendSupportNotification.mock.calls.map(([recipient]) => recipient)).toEqual([
      'berg@lippelift.de',
      'caechma@gmail.com',
    ]);
  });
});
