import type {
  BypassNotification,
  EmailService,
  LeadNotificationContext,
} from '../services/email.js';
import type { PipedriveService } from '../services/pipedrive.js';
import type {
  FactoryCaseResult,
  LeadCrmResult,
  LeadData,
  Mode,
  ServiceRequestCrmResult,
  SupportData,
} from '../types/index.js';
import { classifyRequestPolicy } from './request-policy.js';
import type { RequestJournal } from './request-journal.js';
import { emailRecipientCheckpointStep, parseEmailRecipients } from '../email/recipients.js';
import { buildPipedriveCompletedTranscriptNote } from '../chat/transcript.js';
import {
  buildingTypeLabel,
  liftTypeLabel,
  stairLocationLabel,
  stairTypeLabel,
} from '../lead/lead-options.js';

interface RequestOrchestratorDependencies {
  pipedrive: Pick<PipedriveService,
    'createLead'
    | 'createChatTranscriptNote'
    | 'resolveFactoryCase'
    | 'resolveSupportReferenceCase'
    | 'resolveSupportFollowUpCase'
    | 'createServiceRequest'
    | 'appendServiceRequestToExistingCase'>;
  email: Pick<EmailService, 'sendLeadNotification' | 'sendSupportNotification' | 'sendBypassNotification'>;
  journal: RequestJournal;
  bypass: Readonly<{
    enabled: boolean;
    recipients: readonly string[];
  }>;
  opportunityRecipient: string;
  opportunityCopyRecipients?: string;
  serviceCopyRecipients?: string;
}

export interface RequestExecutionInput {
  sessionId: string;
  requestId: string;
  mode: Mode;
  transcript: string;
  leadData?: LeadData;
  supportData?: SupportData;
}

export interface RequestExecutionResult {
  requestId: string;
  kind: 'opportunity' | 'service';
  completed: true;
  recipient: string;
  crm?: LeadCrmResult | ServiceRequestCrmResult;
  sourceCase?: FactoryCaseResult;
}

export function createRequestOrchestrator(dependencies: RequestOrchestratorDependencies) {
  const {
    pipedrive,
    email,
    journal,
    bypass,
    opportunityRecipient,
    opportunityCopyRecipients,
    serviceCopyRecipients,
  } = dependencies;

  function bypassKind(input: RequestExecutionInput): BypassNotification['kind'] {
    if (input.leadData) return 'opportunity';
    if (input.supportData) return 'service';
    return 'general';
  }

  function bypassSummary(input: RequestExecutionInput): string {
    if (input.leadData) {
      const name = [input.leadData.firstName, input.leadData.lastName].filter(Boolean).join(' ');
      return [
        name ? `Anfrage von ${name}` : 'Neue Anfrage',
        input.leadData.message,
      ].filter(Boolean).join(': ');
    }
    if (input.supportData) {
      return [
        input.supportData.customerName ? `Serviceanfrage von ${input.supportData.customerName}` : 'Neue Serviceanfrage',
        input.supportData.issueDescription,
      ].filter(Boolean).join(': ');
    }
    return 'Neue allgemeine Anfrage';
  }

  function opportunityNoteSummary(data: LeadData, crm: LeadCrmResult): string {
    const name = [data.firstName, data.lastName].filter(Boolean).join(' ');
    const address = [data.street, data.postalCode, data.city].filter(Boolean).join(', ');
    return [
      name && `Anfrage von: ${name}`,
      data.email && `E-Mail: ${data.email}`,
      data.phone && `Telefon: ${data.phone}`,
      address && `Adresse: ${address}`,
      data.availability && `Erreichbarkeit: ${data.availability}`,
      stairLocationLabel(data.stairLocation) && `Treppenstandort: ${stairLocationLabel(data.stairLocation)}`,
      stairTypeLabel(data.stairType) && `Treppenverlauf: ${stairTypeLabel(data.stairType)}`,
      buildingTypeLabel(data.buildingType) && `Gebäude: ${buildingTypeLabel(data.buildingType)}`,
      liftTypeLabel(data.liftType) && `Lifttyp: ${liftTypeLabel(data.liftType)}`,
      data.priorContact && `Vorheriger Kontakt: ${data.priorContact}`,
      data.priorContactReference && `Referenz: ${data.priorContactReference}`,
      data.message && `Anliegen: ${data.message}`,
      `CRM-Ergebnis: ${crm.outcome}`,
    ].filter(Boolean).join('\n');
  }

  async function createOpportunityNote(
    input: RequestExecutionInput,
    leadData: LeadData,
    crm: LeadCrmResult,
  ): Promise<void> {
    if (!crm.personId || !crm.dealId) return;

    const content = buildPipedriveCompletedTranscriptNote({
      sessionId: input.sessionId,
      requestId: input.requestId,
      summary: opportunityNoteSummary(leadData, crm),
      transcript: input.transcript,
    });
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'note' },
      async () => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            return await pipedrive.createChatTranscriptNote(
              input.requestId,
              crm.personId!,
              crm.dealId!,
              content,
            );
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError;
      },
    );
  }

  async function sendToRecipients(
    input: RequestExecutionInput,
    recipients: string[],
    send: (recipient: string) => Promise<void>,
  ): Promise<void> {
    const outcomes = await Promise.allSettled(recipients.map((recipient) => journal.runStep(
      {
        sessionId: input.sessionId,
        requestId: input.requestId,
        step: emailRecipientCheckpointStep(recipient),
      },
      async () => {
        await send(recipient);
        return { sent: true, recipient };
      },
    )));
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  async function executeOpportunity(input: RequestExecutionInput): Promise<RequestExecutionResult> {
    if (!input.leadData) throw new Error('Opportunity request is missing leadData');
    const leadData = input.leadData;
    const crm = await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'crm' },
      async () => ({ ...await pipedrive.createLead(leadData) }),
    ) as LeadCrmResult;
    await createOpportunityNote(input, leadData, crm);
    const emailStep = { sessionId: input.sessionId, requestId: input.requestId, step: 'email' as const };
    const previousEmail = await journal.getStep<{ recipient?: string; recipients?: string[] }>(emailStep);
    const previouslySent = parseEmailRecipients(
      previousEmail?.recipient,
      ...(previousEmail?.recipients ?? []),
    );
    const previouslySentSet = new Set(previouslySent.map((recipient) => recipient.toLowerCase()));
    const recipients = parseEmailRecipients(opportunityRecipient, opportunityCopyRecipients);
    await sendToRecipients(
      input,
      recipients.filter((recipient) => !previouslySentSet.has(recipient.toLowerCase())),
      async (recipient) => {
        await email.sendLeadNotification(recipient, leadData, {
          ...crm as LeadNotificationContext,
          requestId: input.requestId,
          transcript: input.transcript,
        });
      },
    );
    await journal.runStep(
      emailStep,
      async () => {
        return { sent: true, recipient: opportunityRecipient, recipients };
      },
    );
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'completed' },
      async () => ({ completed: true }),
    );
    return {
      requestId: input.requestId,
      kind: 'opportunity',
      completed: true,
      recipient: opportunityRecipient,
      crm,
    };
  }

  async function executeBypass(input: RequestExecutionInput): Promise<RequestExecutionResult> {
    if (!input.leadData && !input.supportData) {
      throw new Error('Bypass request is missing leadData or supportData');
    }

    const recipients = parseEmailRecipients(...bypass.recipients);
    if (recipients.length === 0) throw new Error('Pipedrive bypass has no email recipients');
    const kind = bypassKind(input);
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'crm_bypassed' },
      async () => ({ reason: 'launch_mode' }),
    );
    const notification: BypassNotification = {
      sessionId: input.sessionId,
      requestId: input.requestId,
      kind,
      summary: bypassSummary(input),
      transcript: input.transcript,
      completedAt: new Date().toISOString(),
      ...(input.leadData ? { leadData: input.leadData } : {}),
      ...(input.supportData ? { supportData: input.supportData } : {}),
    };
    await sendToRecipients(
      input,
      recipients,
      async (recipient) => email.sendBypassNotification(recipient, notification),
    );
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'email' },
      async () => ({ sent: true, recipients }),
    );
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'completed' },
      async () => ({ completed: true }),
    );
    return {
      requestId: input.requestId,
      kind: kind === 'opportunity' ? 'opportunity' : 'service',
      completed: true,
      recipient: recipients.join(','),
    };
  }

  async function executeService(input: RequestExecutionInput): Promise<RequestExecutionResult> {
    if (!input.supportData) throw new Error('Service request is missing supportData');
    const supportData = input.supportData;
    const policy = classifyRequestPolicy(supportData);
    if (!policy.recipient) throw new Error('Service request has no recipient');

    let sourceCase: FactoryCaseResult | undefined;
    let crm: ServiceRequestCrmResult | undefined;
    if (policy.crm === 'read_only' || policy.crm === 'create_service_request') {
      if (!supportData.factoryNumber?.trim()) throw new Error('LIPPE request is missing factoryNumber');
      const crmCheckpoint = await journal.runStep(
        { sessionId: input.sessionId, requestId: input.requestId, step: 'crm' },
        async () => {
          const resolvedCase = await pipedrive.resolveFactoryCase(supportData.factoryNumber!);
          if (policy.crm !== 'create_service_request' || resolvedCase.matchState !== 'unique') {
            return { sourceCase: resolvedCase };
          }

          if (supportData.priorContact === 'yes') {
            const referenceCase = await pipedrive.resolveSupportReferenceCase(supportData);
            const targetCase = referenceCase.matchState === 'unresolved'
              ? await pipedrive.resolveSupportFollowUpCase(supportData, resolvedCase)
              : referenceCase;
            if (targetCase.matchState === 'ambiguous') {
              return {
                sourceCase: { matchState: 'ambiguous' as const, candidateCount: targetCase.candidateCount },
                referenceCase,
                targetCase,
              };
            }
            if (targetCase.matchState === 'unresolved') {
              return { sourceCase: targetCase, referenceCase, targetCase };
            }
            if (targetCase.personId !== resolvedCase.personId) {
              return {
                sourceCase: { matchState: 'ambiguous' as const, candidateCount: 2 },
                referenceCase,
                targetCase,
              };
            }
            if (targetCase.dealId === resolvedCase.dealId) {
              return {
                sourceCase: { matchState: 'ambiguous' as const, candidateCount: 1 },
                referenceCase,
                targetCase,
              };
            }
            const reused = await pipedrive.appendServiceRequestToExistingCase({
              requestId: input.requestId,
              data: supportData,
              sourceCase: resolvedCase,
              targetCase,
              transcript: input.transcript,
            });
            return { sourceCase: resolvedCase, referenceCase, targetCase, crm: reused };
          }

          const created = await pipedrive.createServiceRequest({
            requestId: input.requestId,
            data: supportData,
            sourceCase: resolvedCase,
            transcript: input.transcript,
          });
          return { sourceCase: resolvedCase, crm: created };
        },
      );
      sourceCase = crmCheckpoint.sourceCase as FactoryCaseResult;
      crm = crmCheckpoint.crm as ServiceRequestCrmResult | undefined;
    }

    const emailStep = { sessionId: input.sessionId, requestId: input.requestId, step: 'email' as const };
    const previousEmail = await journal.getStep<{ recipient?: string; recipients?: string[] }>(emailStep);
    const previouslySent = parseEmailRecipients(
      previousEmail?.recipient,
      ...(previousEmail?.recipients ?? []),
    );
    const previouslySentSet = new Set(previouslySent.map((recipient) => recipient.toLowerCase()));
    const matchState = sourceCase?.matchState ?? 'unresolved';
    const dealId = crm?.dealId ?? (sourceCase?.matchState === 'unique' ? sourceCase.dealId : undefined);
    const recipients = parseEmailRecipients(policy.recipient, serviceCopyRecipients);
    await sendToRecipients(
      input,
      recipients.filter((recipient) => !previouslySentSet.has(recipient.toLowerCase())),
      async (recipient) => {
        await email.sendSupportNotification(recipient, {
          requestId: input.requestId,
          data: supportData,
          intendedInbox: policy.recipient!,
          matchState,
          noteStatus: crm ? 'created' : 'skipped',
          dealId,
          sourceDealUrl: crm?.sourceDealUrl,
          serviceDealUrl: crm?.serviceDealUrl,
          transcript: input.transcript,
        });
      },
    );
    await journal.runStep(
      emailStep,
      async () => {
        return { sent: true, recipient: policy.recipient!, recipients };
      },
    );
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'completed' },
      async () => ({ completed: true }),
    );

    return {
      requestId: input.requestId,
      kind: 'service',
      completed: true,
      recipient: policy.recipient,
      ...(crm ? { crm } : {}),
      ...(sourceCase ? { sourceCase } : {}),
    };
  }

  async function execute(input: RequestExecutionInput): Promise<RequestExecutionResult> {
    if (!input.requestId.trim()) throw new Error('requestId is required');
    const bypassCheckpoint = await journal.getStep<Record<string, unknown>>({
      sessionId: input.sessionId,
      requestId: input.requestId,
      step: 'crm_bypassed',
    });
    if (bypassCheckpoint) return executeBypass(input);
    if (bypass.enabled) {
      const crmCheckpoint = await journal.getStep<Record<string, unknown>>({
        sessionId: input.sessionId,
        requestId: input.requestId,
        step: 'crm',
      });
      if (!crmCheckpoint) return executeBypass(input);
    }
    if (input.leadData?.ownsLift === 'no' || input.mode === 'anfrage') return executeOpportunity(input);
    return executeService(input);
  }

  return { execute };
}

export type RequestOrchestrator = ReturnType<typeof createRequestOrchestrator>;
