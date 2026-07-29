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
      createChatTranscriptNote: vi.fn().mockResolvedValue({ noteId: 33 }),
      resolveFactoryCase: vi.fn().mockResolvedValue({ matchState: 'unique', personId: 31, dealId: 41, factoryNumber: 'FN-42' }),
      resolveSupportPerson: vi.fn().mockResolvedValue({ matchState: 'unresolved', candidateCount: 0 }),
      createSupportCase: vi.fn().mockResolvedValue({ personId: 31, dealId: 52, createdPerson: true }),
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
      sendBypassNotification: vi.fn().mockResolvedValue(undefined),
    },
    bypass: { enabled: false, recipients: [] as string[] },
  };
}

describe('createRequestOrchestrator', () => {
  it.each([
    {
      label: 'opportunity',
      input: {
        sessionId: 'bypass-opportunity',
        requestId: 'request-opportunity',
        mode: 'anfrage' as const,
        transcript: 'Nutzer: vollständige Opportunity\nSarah: Danke.',
        leadData: {
          ownsLift: 'no' as const,
          firstName: 'Max',
          lastName: 'Muster',
          email: 'max@example.de',
          message: 'Neuer Lift',
        },
      },
    },
    {
      label: 'service',
      input: {
        sessionId: 'bypass-service',
        requestId: 'request-service',
        mode: 'service' as const,
        transcript: 'Nutzer: vollständige Serviceanfrage\nSarah: Danke.',
        supportData: {
          ownsLift: 'yes' as const,
          customerName: 'Erika Muster',
          email: 'erika@example.de',
          category: 'technik' as const,
          issueDescription: 'Lift steht',
        },
      },
    },
  ])('bypasses every Pipedrive operation and department for $label', async ({ input }) => {
    const deps = baseDependencies();
    const { journal, store } = durableJournal();
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      bypass: {
        enabled: true,
        recipients: ['berg@lippelift.de', 'caechma@gmail.com'],
      },
      opportunityRecipient: 'sales@lippelift.de',
      serviceCopyRecipients: 'technik@lippelift.de,finance@lippelift.de,lossau@lippelift.de',
    });

    const result = await orchestrator.execute(input);

    for (const operation of Object.values(deps.pipedrive)) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(deps.email.sendLeadNotification).not.toHaveBeenCalled();
    expect(deps.email.sendSupportNotification).not.toHaveBeenCalled();
    expect(deps.email.sendBypassNotification.mock.calls.map(([recipient]) => recipient)).toEqual([
      'berg@lippelift.de',
      'caechma@gmail.com',
    ]);
    expect(deps.email.sendBypassNotification).toHaveBeenCalledWith(
      'berg@lippelift.de',
      expect.objectContaining({ transcript: input.transcript }),
    );
    expect(result).not.toHaveProperty('crm');
    expect(result).not.toHaveProperty('sourceCase');
    expect(store.map((checkpoint) => checkpoint.step)).toContain('crm_bypassed');
    expect(store.find((checkpoint) => checkpoint.step === 'crm_bypassed')?.payload).toEqual({
      reason: 'launch_mode',
    });
  });

  it('deduplicates bypass recipients and retries only a failed recipient after restart', async () => {
    const deps = baseDependencies();
    let caechmaAttempts = 0;
    deps.email.sendBypassNotification.mockImplementation(async (recipient) => {
      if (recipient.toLowerCase() === 'caechma@gmail.com' && caechmaAttempts++ === 0) {
        throw new Error('caechma SMTP unavailable');
      }
    });
    const { journal, store } = durableJournal();
    const dependencies = {
      ...deps,
      bypass: {
        enabled: true,
        recipients: ['berg@lippelift.de', 'BERG@lippelift.de', 'caechma@gmail.com'],
      },
      opportunityRecipient: 'sales@lippelift.de',
    };
    const input = {
      sessionId: 'bypass-retry',
      requestId: 'bypass-retry-request',
      mode: 'anfrage' as const,
      transcript: 'Nutzer: vollständige Anfrage',
      leadData: { ownsLift: 'no' as const, firstName: 'Retry', email: 'retry@example.de' },
    };

    await expect(createRequestOrchestrator({ ...dependencies, journal }).execute(input))
      .rejects.toThrow('caechma SMTP unavailable');
    expect(store.some((checkpoint) => checkpoint.step === 'completed')).toBe(false);

    await expect(createRequestOrchestrator({
      ...dependencies,
      journal: durableJournal(store).journal,
    }).execute(input)).resolves.toMatchObject({ completed: true });

    expect(deps.email.sendBypassNotification.mock.calls.map(([recipient]) => recipient)).toEqual([
      'berg@lippelift.de',
      'caechma@gmail.com',
      'caechma@gmail.com',
    ]);
  });

  it('keeps a checkpointed bypass request in bypass mode after the launch flag is disabled', async () => {
    const deps = baseDependencies();
    const store: RequestCheckpoint[] = [{
      sessionId: 'mode-pinned',
      requestId: 'mode-pinned-request',
      step: 'crm_bypassed',
      payload: { reason: 'launch_mode' },
    }];
    const orchestrator = createRequestOrchestrator({
      ...deps,
      bypass: { enabled: false, recipients: ['berg@lippelift.de'] },
      journal: durableJournal(store).journal,
      opportunityRecipient: 'sales@lippelift.de',
    });

    await orchestrator.execute({
      sessionId: 'mode-pinned',
      requestId: 'mode-pinned-request',
      mode: 'anfrage',
      transcript: 'Nutzer: Anfrage',
      leadData: { ownsLift: 'no', firstName: 'Pinned', email: 'pinned@example.de' },
    });

    expect(deps.pipedrive.createLead).not.toHaveBeenCalled();
    expect(deps.email.sendBypassNotification).toHaveBeenCalledOnce();
  });

  it('keeps a checkpointed full-workflow request out of bypass after the flag is enabled', async () => {
    const deps = baseDependencies();
    const store: RequestCheckpoint[] = [{
      sessionId: 'full-mode-pinned',
      requestId: 'full-mode-pinned-request',
      step: 'crm',
      payload: { outcome: 'created', personId: 11, dealId: 22, createdPerson: true },
    }];
    const orchestrator = createRequestOrchestrator({
      ...deps,
      bypass: { enabled: true, recipients: ['berg@lippelift.de'] },
      journal: durableJournal(store).journal,
      opportunityRecipient: 'sales@lippelift.de',
    });

    await orchestrator.execute({
      sessionId: 'full-mode-pinned',
      requestId: 'full-mode-pinned-request',
      mode: 'anfrage',
      transcript: 'Nutzer: Anfrage',
      leadData: { ownsLift: 'no', firstName: 'Pinned', email: 'pinned@example.de' },
    });

    expect(deps.email.sendBypassNotification).not.toHaveBeenCalled();
    expect(deps.email.sendLeadNotification).toHaveBeenCalledWith(
      'sales@lippelift.de',
      expect.any(Object),
      expect.objectContaining({ dealId: 22 }),
    );
  });

  it('creates or reuses the opportunity before sending its email', async () => {
    const calls: string[] = [];
    const deps = baseDependencies();
    deps.pipedrive.createLead.mockImplementation(async () => { calls.push('crm'); return { outcome: 'created', personId: 11, dealId: 22, createdPerson: true }; });
    deps.pipedrive.createChatTranscriptNote.mockImplementation(async () => { calls.push('note'); return { noteId: 33 }; });
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

    expect(calls).toEqual(['crm', 'note', 'email', 'email', 'email']);
    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledWith(
      'r1',
      11,
      22,
      expect.stringContaining('<strong>Kurzfassung</strong>'),
    );
    const noteContent = deps.pipedrive.createChatTranscriptNote.mock.calls[0][3];
    expect(noteContent).toContain('<strong>Vollständiges Sarah-Chatprotokoll</strong>');
    expect(noteContent).toContain('[Sarah-Chat-ID:r1]');
    expect(noteContent).toContain('vollstaendig');
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

  it('adds one request-scoped note when an existing opportunity is reused', async () => {
    const deps = baseDependencies();
    deps.pipedrive.createLead.mockResolvedValue({
      outcome: 'reused',
      personId: 11,
      dealId: 22,
      createdPerson: false,
    });
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
    });

    const input = {
      sessionId: 'same-visible-chat',
      requestId: 'second-request-in-chat',
      mode: 'anfrage' as const,
      transcript: 'Nutzer: zweite Anfrage',
      leadData: {
        ownsLift: 'no' as const,
        priorContact: 'yes' as const,
        firstName: 'Max',
        lastName: 'Muster',
        email: 'max@example.de',
      },
    };

    await orchestrator.execute(input);
    await orchestrator.execute(input);

    expect(deps.pipedrive.createLead).toHaveBeenCalledOnce();
    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledOnce();
    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledWith(
      'second-request-in-chat',
      11,
      22,
      expect.stringContaining('[Sarah-Chat-ID:second-request-in-chat]'),
    );
  });

  it('retries the opportunity note before email and does not complete without it', async () => {
    const deps = baseDependencies();
    deps.pipedrive.createChatTranscriptNote
      .mockRejectedValueOnce(new Error('notes unavailable'))
      .mockRejectedValueOnce(new Error('notes unavailable'))
      .mockResolvedValueOnce({ noteId: 33 });
    const { journal, store } = durableJournal();
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
    });

    await orchestrator.execute({
      sessionId: 'note-retry',
      requestId: 'note-retry-request',
      mode: 'anfrage',
      transcript: 'Nutzer: vollständige Anfrage',
      leadData: {
        ownsLift: 'no',
        priorContact: 'no',
        firstName: 'Max',
        lastName: 'Muster',
        email: 'max@example.de',
      },
    });

    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledTimes(3);
    expect(deps.email.sendLeadNotification).toHaveBeenCalledOnce();
    expect(store.map((checkpoint) => checkpoint.step)).toEqual(
      expect.arrayContaining(['crm', 'note', 'email', 'completed']),
    );
  });

  it('stops before email and completion when the opportunity note cannot be saved', async () => {
    const deps = baseDependencies();
    deps.pipedrive.createChatTranscriptNote.mockRejectedValue(new Error('notes unavailable'));
    const { journal, store } = durableJournal();
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
    });

    await expect(orchestrator.execute({
      sessionId: 'note-failure',
      requestId: 'note-failure-request',
      mode: 'anfrage',
      transcript: 'Nutzer: vollständige Anfrage',
      leadData: {
        ownsLift: 'no',
        priorContact: 'no',
        firstName: 'Max',
        lastName: 'Muster',
        email: 'max@example.de',
      },
    })).rejects.toThrow('notes unavailable');

    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledTimes(3);
    expect(deps.email.sendLeadNotification).not.toHaveBeenCalled();
    expect(store.some((checkpoint) => checkpoint.step === 'completed')).toBe(false);
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
  ])('creates a Sales opportunity and note when $label has no unique original deal', async ({ label, data }) => {
    const deps = baseDependencies();
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
      serviceCopyRecipients: 'berg@lippelift.de,caechma@gmail.com',
    });

    const result = await orchestrator.execute({
      sessionId: 's1', requestId: `r-${label}`, mode: 'service', transcript: 'vollstaendig',
      supportData: { ...data, customerName: 'Erika Muster', email: 'erika@example.de', category: data.serviceRequestType === 'invoice_payment' ? 'finance' : 'technik', issueDescription: 'Bitte pruefen.' },
    });

    expect(deps.pipedrive.resolveFactoryCase).not.toHaveBeenCalled();
    expect(deps.pipedrive.createServiceRequest).not.toHaveBeenCalled();
    expect(deps.pipedrive.createSupportCase).toHaveBeenCalledTimes(1);
    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledWith(
      expect.any(String),
      31,
      52,
      expect.stringContaining('Zielteam: sales@lippelift.de'),
    );
    expect(deps.email.sendSupportNotification.mock.calls.map(([address]) => address)).toEqual([
      'berg@lippelift.de',
      'caechma@gmail.com',
    ]);
    expect(deps.email.sendSupportNotification).toHaveBeenLastCalledWith(
      'caechma@gmail.com', expect.objectContaining({ intendedInbox: 'sales@lippelift.de' }),
    );
    expect(result).toMatchObject({
      kind: 'service',
      completed: true,
      recipient: 'sales@lippelift.de',
      crm: { outcome: 'created', dealId: 52 },
    });
  });

  it('reuses an existing ordered-lift opportunity and writes the transcript there', async () => {
    const deps = baseDependencies();
    deps.pipedrive.resolveSupportPerson.mockResolvedValue({
      matchState: 'unique',
      personId: 31,
      dealId: 41,
      candidateCount: 1,
    });
    const { journal } = durableJournal();
    const orchestrator = createRequestOrchestrator({
      ...deps,
      journal,
      opportunityRecipient: 'sales@lippelift.de',
    });

    const result = await orchestrator.execute({
      sessionId: 'ordered-lift',
      requestId: 'ordered-lift-request',
      mode: 'service',
      transcript: 'Nutzer: Ich habe einen Lift bestellt.',
      supportData: {
        requestSituation: 'ordered_not_installed',
        ownsLift: 'no',
        priorContact: 'yes',
        serviceRequestType: 'sales_contract_order',
        customerName: 'patrick Berg',
        email: 'patrick-berg@online.de',
        category: 'sales',
        issueDescription: 'Ich höre nichts mehr zum Status.',
      },
    });

    expect(deps.pipedrive.createSupportCase).not.toHaveBeenCalled();
    expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledWith(
      'ordered-lift-request',
      31,
      41,
      expect.stringContaining('Nutzer: Ich habe einen Lift bestellt.'),
    );
    expect(result).toMatchObject({
      kind: 'service',
      completed: true,
      crm: { outcome: 'reused', personId: 31, dealId: 41, createdPerson: false },
    });
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

  it.each([
    { hasMontageDate: true, intendedInbox: 'lossau@lippelift.de' },
    { hasMontageDate: false, intendedInbox: 'sales@lippelift.de' },
  ])(
    'routes a uniquely matched original deal with Montagedatum=$hasMontageDate to $intendedInbox',
    async ({ hasMontageDate, intendedInbox }) => {
      const deps = baseDependencies();
      deps.pipedrive.resolveFactoryCase.mockResolvedValue({
        matchState: 'unique',
        personId: 31,
        dealId: 41,
        factoryNumber: 'FN-42',
        hasMontageDate,
      });
      const { journal } = durableJournal();
      const orchestrator = createRequestOrchestrator({
        ...deps,
        journal,
        opportunityRecipient: 'sales@lippelift.de',
        serviceCopyRecipients: 'berg@lippelift.de,caechma@gmail.com',
      });

      const result = await orchestrator.execute({
        sessionId: `montage-${hasMontageDate}`,
        requestId: `montage-request-${hasMontageDate}`,
        mode: 'service',
        transcript: 'vollständiger Chat',
        supportData: {
          ownsLift: 'yes',
          liftManufacturer: 'lippe',
          factoryNumber: 'FN-42',
          factoryNumberStatus: 'provided',
          serviceRequestType: 'maintenance',
          customerName: 'Erika Muster',
          email: 'erika@example.de',
          category: 'technik',
          issueDescription: 'Wartung gewünscht.',
        },
      });

      expect(deps.pipedrive.createSupportCase).not.toHaveBeenCalled();
      expect(deps.pipedrive.createChatTranscriptNote).toHaveBeenCalledWith(
        expect.any(String),
        31,
        41,
        expect.stringContaining(`Zielteam: ${intendedInbox}`),
      );
      expect(deps.email.sendSupportNotification.mock.calls.map(([recipient]) => recipient)).toEqual([
        'berg@lippelift.de',
        'caechma@gmail.com',
      ]);
      expect(deps.email.sendSupportNotification).toHaveBeenLastCalledWith(
        'caechma@gmail.com',
        expect.objectContaining({ intendedInbox, noteStatus: 'created' }),
      );
      expect(result).toMatchObject({ recipient: intendedInbox, sourceCase: { dealId: 41 } });
    },
  );

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
    expect(result.sourceCase).toEqual({ matchState: 'unique', personId: 31, dealId: 41, factoryNumber: 'FN-42' });
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
    expect(result.sourceCase).toEqual({ matchState: 'unique', personId: 31, dealId: 41, factoryNumber: 'FN-42' });
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
    expect(result.sourceCase).toEqual({ matchState: 'unique', personId: 31, dealId: 41, factoryNumber: 'FN-42' });
    expect(deps.email.sendSupportNotification).toHaveBeenCalledWith(
      'technik@lippelift.de',
      expect.objectContaining({ matchState: 'unique', dealId: 41 }),
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
