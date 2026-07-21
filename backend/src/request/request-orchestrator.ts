import type { EmailService, LeadNotificationContext } from '../services/email.js';
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

interface RequestOrchestratorDependencies {
  pipedrive: Pick<PipedriveService, 'createLead' | 'resolveFactoryCase' | 'createServiceRequest'>;
  email: Pick<EmailService, 'sendLeadNotification' | 'sendSupportNotification'>;
  journal: RequestJournal;
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
    opportunityRecipient,
    opportunityCopyRecipients,
    serviceCopyRecipients,
  } = dependencies;

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
    if (input.leadData?.ownsLift === 'no' || input.mode === 'anfrage') return executeOpportunity(input);
    return executeService(input);
  }

  return { execute };
}

export type RequestOrchestrator = ReturnType<typeof createRequestOrchestrator>;
