export type LiveCheckpoint = {
  step: string;
  result: Record<string, unknown>;
};

type LiveFixtures = {
  people?: number[];
  deals?: number[];
};

export function buildRunUniquePhone(runId: string, caseNumber: number): string {
  const runDigits = runId.replace(/\D/g, '').slice(-6).padStart(6, '0');
  const caseDigits = String(caseNumber).padStart(2, '0').slice(-2);
  return `+49 151 ${runDigits}${caseDigits}`;
}

export function shouldRetryChatAttempt(
  events: Array<Record<string, unknown>>,
  completed: boolean,
  completionRequired: boolean,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (attempt >= maxAttempts) return false;
  return events.some((event) => event.type === 'error') || (completionRequired && !completed);
}

export function opportunityCheckpointMatches(
  useCase: string,
  checkpoints: LiveCheckpoint[],
  fixtures: LiveFixtures,
): boolean {
  if (useCase !== 'UC-02' && useCase !== 'UC-03') return true;

  const fixtureIndex = useCase === 'UC-02' ? 0 : 1;
  const expectedPersonId = fixtures.people?.[fixtureIndex];
  const expectedDealId = fixtures.deals?.[fixtureIndex];
  const crm = checkpoints.find((checkpoint) => checkpoint.step === 'crm')?.result;

  return crm?.outcome === 'reused'
    && Number(crm.personId) === expectedPersonId
    && Number(crm.dealId) === expectedDealId;
}
