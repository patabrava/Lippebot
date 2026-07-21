import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Json = Record<string, unknown>;
const runId = process.env.LIVE_E2E_RUN_ID;
const apiKey = process.env.PIPEDRIVE_API_KEY;
if (!runId || !apiKey) throw new Error('LIVE_E2E_RUN_ID and PIPEDRIVE_API_KEY are required');
const outputDir = resolve(process.cwd(), 'output', `request-routing-${runId}`);
const chat = JSON.parse(await readFile(resolve(outputDir, 'chat-results.json'), 'utf8')) as { results: Array<Json>; fixtures: Json };

async function pd<T>(path: string): Promise<T> {
  const join = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.pipedrive.com/v1${path}${join}api_token=${encodeURIComponent(apiKey!)}`);
  const payload = await response.json() as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !payload.success) throw new Error(`Pipedrive ${path}: ${response.status} ${payload.error || response.statusText}`);
  return payload.data as T;
}

function id(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return id((value as Json).id ?? (value as Json).value);
  return undefined;
}

const notes = await pd<Array<Json>>('/notes?limit=500');
const peopleSearch = await pd<{ items?: Array<{ item?: Json }> }>(`/persons/search?term=${encodeURIComponent(`Eetwo`)}&fields=name&exact_match=false&limit=100`);
const people = (peopleSearch.items || []).map((entry) => entry.item).filter(Boolean) as Json[];
const personDetails = await Promise.all(people.map(async (person) => {
  const personId = id(person.id)!;
  const deals = (await pd<Array<Json> | null>(`/persons/${personId}/deals?status=open`)) ?? [];
  return { personId, name: person.name, deals };
}));

const allDeals = personDetails.flatMap((person) => person.deals);
const dealNotes = (await Promise.all(allDeals.map(async (deal) => {
  const dealId = id(deal.id)!;
  const rows = (await pd<Array<Json> | null>(`/notes?deal_id=${dealId}`)) ?? [];
  return rows.map((note) => ({ ...note, deal_id: dealId }));
}))).flat();

function serviceDealFormatIsExact(deal: Json): boolean {
  return typeof deal.title === 'string'
    && deal.title.startsWith('Serviceanfrage - ')
    && id(deal.pipeline_id) === 1
    && id(deal.stage_id) === 2
    && id(deal.user_id) === 24093328
    && Number(deal.value) === 0
    && deal.currency === 'EUR'
    && deal.status === 'open';
}

const suffix = runId.slice(-8);
function dealsFor(name: string): Json[] {
  return personDetails.filter((person) => person.name === name).flatMap((person) => person.deals);
}

function opportunityShapeMatches(useCase: string): boolean {
  if (useCase === 'UC-01') {
    return dealsFor(`Eetwo New ${suffix}`).filter((deal) => deal.title === `Sarah Lead: Eetwo New ${suffix}`).length === 1;
  }
  if (useCase === 'UC-02') {
    const deals = dealsFor(`Eetwo Unique ${suffix}`);
    return deals.some((deal) => id(deal.id) === Number((chat.fixtures as Json).deals && ((chat.fixtures as Json).deals as number[])[0]))
      && !deals.some((deal) => String(deal.title).startsWith('Sarah Lead:'));
  }
  if (useCase === 'UC-03') {
    const deals = dealsFor(`Eetwo Prior ${suffix}`);
    return deals.length === 1 && !deals.some((deal) => String(deal.title).startsWith('Sarah Lead:'));
  }
  if (useCase === 'UC-04') return !personDetails.some((person) => person.name === `Eetwo Missing ${suffix}`);
  if (useCase === 'UC-05') {
    const matches = personDetails.filter((person) => person.name === `Eetwo Ambiguous ${suffix}`);
    return matches.length === 2 && matches.every((person) => person.deals.length === 1);
  }
  if (useCase === 'UC-15') {
    return dealsFor(`Eetwo Multi ${suffix}`).filter((deal) => String(deal.title).startsWith('Sarah Lead:')).length === 1;
  }
  return true;
}

const evidence = chat.results.map((result) => {
  const requestId = String(result.requestId);
  const markerNotes = [...notes, ...dealNotes].filter((note) => typeof note.content === 'string' && note.content.includes(`[LIPPEBOT REQUEST:${requestId}]`));
  const uniqueMarkerNotes = [...new Map(markerNotes.map((note) => [id(note.id), note])).values()];
  const markerDeals = uniqueMarkerNotes.map((note) => {
    const dealId = id(note.deal_id);
    return allDeals.find((deal) => id(deal.id) === dealId);
  }).filter(Boolean) as Json[];
  const expectsServiceDeal = ['UC-11', 'UC-12', 'UC-13', 'UC-14', 'UC-16'].includes(String(result.useCase));
  const expectsNoServiceDeal = !expectsServiceDeal;
  const crmShapeMatches = expectsServiceDeal
    ? markerDeals.length === 1 && markerDeals.every(serviceDealFormatIsExact)
    : expectsNoServiceDeal && markerDeals.length === 0;
  const emergencyMatches = result.useCase !== 'UC-17' || (
    !result.completed
    && markerDeals.length === 0
    && Array.isArray(result.events)
    && result.events.some((event: Json) => String(event.content ?? '').includes('112') && String(event.content ?? '').includes('+49 (0)5261 9666-0'))
  );
  const opportunityMatches = opportunityShapeMatches(String(result.useCase));
  const pass = result.useCase === 'UC-17'
    ? emergencyMatches
    : Boolean(result.completed && crmShapeMatches && opportunityMatches);
  return {
    useCase: result.useCase,
    subject: result.subject,
    requestId,
    expected: result.expected,
    recipient: result.recipient,
    chatCompleted: result.completed,
    markerNoteIds: uniqueMarkerNotes.map((note) => id(note.id)),
    serviceDeals: markerDeals.map((deal) => ({
      id: id(deal.id), title: deal.title, personId: id(deal.person_id), pipelineId: id(deal.pipeline_id),
      stageId: id(deal.stage_id), ownerId: id(deal.user_id), value: deal.value, currency: deal.currency, status: deal.status,
      url: `https://lippelift.pipedrive.com/deal/${id(deal.id)}`,
    })),
    recipientVerification: result.recipient === 'none' ? 'not_applicable' : 'pending_gmail_readback',
    crmShapeMatches,
    opportunityMatches,
    pass,
  };
});

const artifact = { runId, readAt: new Date().toISOString(), fixtures: chat.fixtures, evidence, people: personDetails };
await writeFile(resolve(outputDir, 'pipedrive-readback.json'), `${JSON.stringify(artifact, null, 2)}\n`);
const failures = evidence.filter((row) => !row.pass);
console.log(JSON.stringify({ runId, outputDir, evidenceRows: evidence.length, serviceDeals: evidence.flatMap((row) => row.serviceDeals).length, failures: failures.map((row) => row.subject) }, null, 2));
if (failures.length) process.exitCode = 1;
