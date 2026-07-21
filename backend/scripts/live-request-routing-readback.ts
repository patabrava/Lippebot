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
const peopleSearch = await pd<{ items?: Array<{ item?: Json }> }>(`/persons/search?term=${encodeURIComponent(`Eetwo`)}&fields=name&exact_match=false&limit=500`);
const people = (peopleSearch.items || []).map((entry) => entry.item).filter(Boolean) as Json[];
const personDetails = await Promise.all(people.map(async (person) => {
  const personId = id(person.id)!;
  const deals = await pd<Array<Json>>(`/persons/${personId}/deals?status=all`);
  return { personId, name: person.name, deals };
}));

const evidence = chat.results.map((result) => {
  const requestId = String(result.requestId);
  const markerNotes = notes.filter((note) => typeof note.content === 'string' && note.content.includes(`[LIPPEBOT REQUEST:${requestId}]`));
  const markerDeals = markerNotes.map((note) => {
    const dealId = id(note.deal_id);
    return personDetails.flatMap((person) => person.deals).find((deal) => id(deal.id) === dealId);
  }).filter(Boolean) as Json[];
  return {
    useCase: result.useCase,
    subject: result.subject,
    requestId,
    expected: result.expected,
    recipient: result.recipient,
    chatCompleted: result.completed,
    markerNoteIds: markerNotes.map((note) => id(note.id)),
    serviceDeals: markerDeals.map((deal) => ({
      id: id(deal.id), title: deal.title, personId: id(deal.person_id), pipelineId: id(deal.pipeline_id),
      stageId: id(deal.stage_id), ownerId: id(deal.user_id), value: deal.value, currency: deal.currency, status: deal.status,
      url: `https://lippelift.pipedrive.com/deal/${id(deal.id)}`,
    })),
  };
});

const artifact = { runId, readAt: new Date().toISOString(), fixtures: chat.fixtures, evidence, people: personDetails };
await writeFile(resolve(outputDir, 'pipedrive-readback.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ runId, outputDir, evidenceRows: evidence.length, serviceDeals: evidence.flatMap((row) => row.serviceDeals).length }, null, 2));
