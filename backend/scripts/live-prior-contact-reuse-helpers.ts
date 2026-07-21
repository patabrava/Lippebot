export type LiveReuseCheckpoint = {
  step: string;
  result: Record<string, unknown>;
};

export type OpportunityCrmEvidence = {
  outcome: string;
  personId: number;
  dealId: number;
  createdPerson?: boolean;
};

export type ServiceCrmEvidence = {
  personId: number;
  sourceDealId: number;
  sourceCaseDealId: number;
  dealId: number;
  noteId: number;
  reused: boolean;
  targetDealId?: number;
};

export type PipedriveDealField = {
  key: string;
  name: string;
  field_type?: string;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveId(value: unknown, label: string): number {
  const nested = object(value);
  const candidate = nested ? nested.id ?? nested.value : value;
  const id = typeof candidate === 'number' ? candidate : Number(candidate);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is missing a positive ID`);
  return id;
}

function crmCheckpoint(checkpoints: LiveReuseCheckpoint[]): Record<string, unknown> {
  const matches = checkpoints.filter((checkpoint) => checkpoint.step === 'crm');
  if (matches.length !== 1) throw new Error(`Expected exactly one CRM checkpoint, found ${matches.length}`);
  return matches[0].result;
}

export function extractOpportunityCrm(checkpoints: LiveReuseCheckpoint[]): OpportunityCrmEvidence {
  const crm = crmCheckpoint(checkpoints);
  if (typeof crm.outcome !== 'string') throw new Error('Opportunity CRM checkpoint is missing an outcome');
  return {
    outcome: crm.outcome,
    personId: positiveId(crm.personId, 'Opportunity person'),
    dealId: positiveId(crm.dealId, 'Opportunity deal'),
    ...(typeof crm.createdPerson === 'boolean' ? { createdPerson: crm.createdPerson } : {}),
  };
}

export function extractServiceCrm(checkpoints: LiveReuseCheckpoint[]): ServiceCrmEvidence {
  const checkpoint = crmCheckpoint(checkpoints);
  const crm = object(checkpoint.crm);
  const sourceCase = object(checkpoint.sourceCase);
  if (!crm) throw new Error('Service CRM checkpoint is missing its CRM result');
  if (!sourceCase || sourceCase.matchState !== 'unique') {
    throw new Error('Service CRM checkpoint is missing a unique source case');
  }
  const referenceCase = object(checkpoint.referenceCase);
  const targetCase = object(checkpoint.targetCase) ?? referenceCase;
  return {
    personId: positiveId(crm.personId, 'Service person'),
    sourceDealId: positiveId(crm.sourceDealId, 'Service source deal'),
    sourceCaseDealId: positiveId(sourceCase.dealId, 'Service source case'),
    dealId: positiveId(crm.dealId, 'Service deal'),
    noteId: positiveId(crm.noteId, 'Service note'),
    reused: crm.reused === true,
    ...(targetCase?.matchState === 'unique'
      ? { targetDealId: positiveId(targetCase.dealId, 'Service target deal') }
      : {}),
  };
}

export function requireOpportunityReuse(
  initial: OpportunityCrmEvidence,
  followUp: OpportunityCrmEvidence,
): { personId: number; dealId: number } {
  if (initial.outcome !== 'created') throw new Error(`Initial opportunity was not created: ${initial.outcome}`);
  if (followUp.outcome !== 'reused') throw new Error(`Follow-up opportunity was not reused: ${followUp.outcome}`);
  if (initial.personId !== followUp.personId || initial.dealId !== followUp.dealId) {
    throw new Error('Opportunity sessions did not resolve to the same person and deal');
  }
  return { personId: initial.personId, dealId: initial.dealId };
}

export function requireServiceReuse(
  initial: ServiceCrmEvidence,
  followUp: ServiceCrmEvidence,
): {
    personId: number;
    sourceDealId: number;
    dealId: number;
    initialNoteId: number;
    followUpNoteId: number;
  } {
  if (initial.reused) throw new Error('Initial support request unexpectedly reused an existing service case');
  if (!followUp.reused) throw new Error('Support follow-up did not reuse its existing service case');
  if (initial.personId !== followUp.personId
    || initial.dealId !== followUp.dealId
    || initial.sourceDealId !== followUp.sourceDealId
    || initial.sourceCaseDealId !== followUp.sourceCaseDealId) {
    throw new Error('Support sessions did not resolve to the same service case and source deal');
  }
  if (followUp.targetDealId !== initial.dealId) {
    throw new Error('Support follow-up did not resolve the exact existing service deal');
  }
  if (initial.noteId === followUp.noteId) {
    throw new Error('Support follow-up did not create a separate request note on the existing case');
  }
  return {
    personId: initial.personId,
    sourceDealId: initial.sourceDealId,
    dealId: initial.dealId,
    initialNoteId: initial.noteId,
    followUpNoteId: followUp.noteId,
  };
}

export function assertEmailRecipientCheckpoints(
  checkpoints: LiveReuseCheckpoint[],
  expectedRecipients: string[],
): string[] {
  const expected = [...new Set(expectedRecipients.map((recipient) => recipient.trim().toLowerCase()))].sort();
  const actual = checkpoints
    .filter((checkpoint) => checkpoint.step.startsWith('email_recipient:') && checkpoint.result.sent === true)
    .map((checkpoint) => checkpoint.step.slice('email_recipient:'.length).trim().toLowerCase())
    .sort();
  const hasEmail = checkpoints.filter((checkpoint) => checkpoint.step === 'email' && checkpoint.result.sent === true).length === 1;
  const hasCompletion = checkpoints.filter((checkpoint) => checkpoint.step === 'completed' && checkpoint.result.completed === true).length === 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected) || !hasEmail || !hasCompletion) {
    throw new Error(`Email recipient checkpoints did not match: expected ${expected.join(',')}; received ${actual.join(',')}`);
  }
  return actual;
}

export function parseRetentionSchedule(value: string | undefined): number[] {
  const raw = value?.trim() || '0,60';
  const values = raw.split(',').map((part) => Number(part.trim()));
  if (values.length === 0 || values.some((seconds) => !Number.isInteger(seconds) || seconds < 0 || seconds > 3600)) {
    throw new Error('Invalid LIVE_E2E_RETENTION_SCHEDULE_SECONDS retention schedule');
  }
  return [...new Set([0, ...values])].sort((left, right) => left - right);
}
