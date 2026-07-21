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

interface RequestOrchestratorDependencies {
  pipedrive: Pick<PipedriveService, 'createLead' | 'resolveFactoryCase' | 'createServiceRequest'>;
  email: Pick<EmailService, 'sendLeadNotification' | 'sendSupportNotification'>;
  journal: RequestJournal;
  opportunityRecipient: string;
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
  const { pipedrive, email, journal, opportunityRecipient } = dependencies;

  async function executeOpportunity(input: RequestExecutionInput): Promise<RequestExecutionResult> {
    if (!input.leadData) throw new Error('Opportunity request is missing leadData');
    const leadData = input.leadData;
    const crm = await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'crm' },
      async () => ({ ...await pipedrive.createLead(leadData) }),
    ) as LeadCrmResult;
    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'email' },
      async () => {
        await email.sendLeadNotification(opportunityRecipient, leadData, crm as LeadNotificationContext);
        return { sent: true, recipient: opportunityRecipient };
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

    await journal.runStep(
      { sessionId: input.sessionId, requestId: input.requestId, step: 'email' },
      async () => {
        const matchState = sourceCase?.matchState ?? 'unresolved';
        const dealId = crm?.dealId ?? (sourceCase?.matchState === 'unique' ? sourceCase.dealId : undefined);
        await email.sendSupportNotification(policy.recipient!, {
          data: supportData,
          intendedInbox: policy.recipient!,
          matchState,
          noteStatus: crm ? 'created' : 'skipped',
          dealId,
        });
        return { sent: true, recipient: policy.recipient! };
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
