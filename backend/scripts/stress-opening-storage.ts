/** Exercise the real model from each opening through confirmation and CRM readback.
 * Default: capture handoffs without external writes.
 * OPENING_STRESS_LIVE_CRM=YES enables clearly labelled Pipedrive fixtures.
 * Email and conversation tracking are always disconnected.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createChatRoute } from '../src/routes/chat.js';
import { createGeminiService } from '../src/services/gemini.js';
import { createPipedriveService } from '../src/services/pipedrive.js';
import { createRequestOrchestrator, type RequestExecutionInput } from '../src/request/request-orchestrator.js';
import { createRequestJournal } from '../src/request/request-journal.js';
import { loadConfig } from '../src/config/index.js';
import { buildNextMissingQuestion } from '../src/request/intake-verification.js';
import type { ConversationTracker } from '../src/services/conversation-tracking.js';
import type { EmailService } from '../src/services/email.js';
import type { ChatMessage, SSEEvent } from '../src/types/index.js';
import { buildRunUniquePhone } from './live-request-routing-helpers.js';

const config = loadConfig();
const live = process.env.OPENING_STRESS_LIVE_CRM === 'YES';
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const suffix = [...runId.slice(-8)].map((digit) => String.fromCharCode(97 + Number(digit))).join('');
const outputDir = resolve('output', `opening-storage-${runId}`);
await mkdir(outputDir, { recursive: true });
const captured: RequestExecutionInput[] = [];
const gemini = createGeminiService({ projectId: config.vertexAiProjectId, location: config.vertexAiLocation, apiKey: config.vertexAiApiKey, enabled: config.vertexAiEnabled });
const disconnected = new Proxy({}, { get: (_target, key) => {
  if (key === 'isConfigured') return () => false;
  return () => { throw new Error(`Unexpected external call: ${String(key)}`); };
} });
const app = createChatRoute({
  gemini, pipedrive: disconnected as ReturnType<typeof createPipedriveService>, email: disconnected as EmailService,
  notificationEmailTo: '', serviceEmailTo: '',
  requestOrchestrator: { execute: async (input) => {
    captured.push(input);
    return { requestId: input.requestId, kind: input.leadData ? 'opportunity' : 'service', completed: true, recipient: 'test@example.invalid' };
  } },
});
const scenarios = [
  { id: 'lift', entries: ['Welcher Lift passt zu mir?', 'Meine Mutter kommt die Innentreppe kaum noch herunter. Sie möchte selbstständig in den Garten. Eine einfache Bedienung ist ihr wichtig.', 'Ich möchte jetzt eine Beratung durch einen Mitarbeiter und ein Angebot für einen neuen Lift.'], terms: ['Garten', 'Bedienung'] },
  { id: 'funding', entries: ['Förderung & Zuschüsse', 'Ich brauche Hilfe beim Antrag bei der Pflegekasse. Ein Pflegegrad ist bereits vorhanden.', 'Ich möchte jetzt ein Angebot für einen neuen Lift und eine Beratung durch einen Mitarbeiter, auch zum Förderantrag.'], terms: ['Pflege', 'Antrag'] },
  { id: 'service', entries: ['Service & Wartung', 'Ich möchte erst einmal wissen, wie eine Wartung abläuft.', 'Mein Sitzlift ist schon eingebaut und jetzt kaputt. Er bleibt auf halber Strecke stehen. Niemand ist eingeschlossen. Ich möchte das zur Reparatur weitergeben.'], terms: ['halber Strecke', 'Reparatur'] },
];

async function runScenario(index: number) {
  const scenario = scenarios[index];
  const requestId = `opening-storage-${runId}-${scenario.id}`;
  const name = `Lippebot Eetwo${scenario.id}${suffix}`;
  const email = `opening.${scenario.id}.${runId}@example.invalid`;
  const correctedEmail = `corrected.${scenario.id}.${runId}@example.invalid`;
  const phone = index === 1 ? buildRunUniquePhone(runId, 81) : undefined;
  const history: ChatMessage[] = [];
  let message = scenario.entries[0];
  let entry = 0;
  let corrected = false;
  let finished = false;
  async function send(value: string, requestHistory = history): Promise<SSEEvent[]> {
    const raw = await (await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: requestId, requestId, message: value, history: requestHistory }) })).text();
    const events: SSEEvent[] = raw.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
    assert(!events.some((event) => event.type === 'error'), `${scenario.id}: API error`);
    return events;
  }
  for (let turn = 0; turn < 24; turn += 1) {
    const requestHistory = history.slice();
    const events = await send(message);
    const reply = events.filter((event) => event.type === 'token').map((event) => event.content).join('');
    const done = events.find((event) => event.type === 'done');
    assert(done, 'Missing final state');
    console.log(JSON.stringify({ scenario: scenario.id, turn: turn + 1, mode: done.mode, reply }));
    history.push({ role: 'user', content: message, timestamp: Date.now() }, { role: 'assistant', content: reply, timestamp: Date.now() });
    if (turn < 2) {
      assert.equal(done.mode, 'berater', 'Opening started intake too soon');
      assert(!/Telefonnummer|E-Mail-Adresse|Fabriknummer|Wie ist dein.*Name/i.test(reply));
    }
    if (events.some((event) => event.action === 'request_completed')) {
      assert(corrected, 'Completed before the correction test');
      finished = true;
      const duplicates = await Promise.all([send('Ja', requestHistory), send('Ja', requestHistory)]);
      assert(duplicates.every((batch) => batch.some((event) => event.action === 'request_completed')));
      break;
    }
    if (entry + 1 < scenario.entries.length) { message = scenario.entries[++entry]; continue; }
    if (/Sind alle Angaben korrekt/.test(reply)) {
      assert(!captured.some((input) => input.requestId === requestId), 'Submitted before confirmation');
      message = corrected ? 'Ja' : `Korrektur: Meine E-Mail-Adresse ist ${correctedEmail}`;
      corrected = true;
      continue;
    }
    const prompt = buildNextMissingQuestion(done.mode!, done.collectedData ?? {});
    if (/vollständiger Name/i.test(prompt)) message = name;
    else if (/E-Mail-Adresse und Telefonnummer/i.test(prompt)) message = phone ? `${email}, Telefon: ${phone}` : email;
    else if (/Wie lautet deine E-Mail-Adresse/i.test(prompt)) message = email;
    else if (/Wie lautet deine Telefonnummer/i.test(prompt)) message = phone ?? 'Ich möchte keine Telefonnummer angeben. Bitte nur per E-Mail.';
    else if (/Hattest du wegen/i.test(prompt)) message = 'Nein';
    else if (/drinnen oder draußen/i.test(prompt)) message = 'drinnen';
    else if (/gerade oder kurvig/i.test(prompt)) message = 'gerade';
    else if (/Sitzlift oder/i.test(prompt)) message = 'Sitzlift';
    else if (/Einfamilienhaus oder/i.test(prompt)) message = 'Einfamilienhaus';
    else if (/private Anfrage oder/i.test(prompt)) message = 'privat';
    else if (/Adresse/i.test(prompt)) message = 'Teststraße 18, 32657 Lemgo';
    else if (/Wann bist du.*erreichbar/i.test(prompt)) message = '08:00–12:00';
    else if (/LIPPE Lift oder/i.test(prompt)) message = 'LIPPE Lift';
    else if (/Fabriknummer/i.test(prompt)) message = 'Ich kann die Fabriknummer nicht finden.';
    else throw new Error(`Unexpected next question: ${prompt}`);
  }
  assert(finished, `${scenario.id}: conversation did not finish`);
  const inputs = captured.filter((input) => input.requestId === requestId);
  assert.equal(inputs.length, 1, 'Duplicate submission');
  const input = inputs[0];
  const data = input.leadData ?? input.supportData!;
  assert.equal(data.email, correctedEmail);
  for (const term of scenario.terms) {
    assert(input.transcript.includes(term), `Transcript lost ${term}`);
    assert((input.leadData?.message ?? input.supportData?.issueDescription ?? '').toLowerCase().includes(term.toLowerCase()), `Summary lost ${term}`);
  }
  if (scenario.id !== 'service') {
    assert.deepEqual([input.leadData?.stairLocation, input.leadData?.stairType, input.leadData?.liftType, input.leadData?.buildingType, input.leadData?.customerSegment], ['innen', 'gerade', 'sitzlift', 'einfamilienhaus', 'privatperson']);
  } else assert.equal(input.supportData?.serviceRequestType, 'repair');
  await writeFile(resolve(outputDir, `${scenario.id}-conversation.json`), JSON.stringify({ input, history }, null, 2));
  return input;
}

const replayDir = process.env.OPENING_STRESS_REPLAY_DIR;
const results = await Promise.allSettled(scenarios.map(async (scenario, index) => {
  if (!replayDir) return runScenario(index);
  const saved = JSON.parse(await readFile(resolve(replayDir, `${scenario.id}-conversation.json`), 'utf8')) as { input: RequestExecutionInput };
  assert(saved.input.requestId.startsWith('opening-storage-'));
  const data = saved.input.leadData ?? saved.input.supportData!;
  assert(data.email?.endsWith('@example.invalid'), 'Replay requires a synthetic test contact');
  captured.push(saved.input);
  return saved.input;
}));
const failures = results.flatMap((result, index) => result.status === 'rejected' ? [{ scenario: scenarios[index].id, error: String(result.reason) }] : []);
await writeFile(resolve(outputDir, 'conversation-results.json'), JSON.stringify({ runId, failures, completed: captured.length }, null, 2));
assert.equal(failures.length, 0, JSON.stringify(failures));

const crmEvidence: unknown[] = [];
if (live) {
  assert(config.pipedriveApiKey, 'Pipedrive is not configured');
  const pd = async (path: string) => {
    const url = new URL(`https://api.pipedrive.com/v1${path}`);
    url.searchParams.set('api_token', config.pipedriveApiKey);
    const response = await fetch(url);
    const body = await response.json() as { success: boolean; data: any };
    assert(response.ok && body.success, `Readback failed: ${path} (${response.status})`);
    return body.data;
  };
  const pipedrive = createPipedriveService(config.pipedriveApiKey, config.pipedrivePipelineId, config.pipedriveStageId);
  const tracker = { getRequestEvents: async () => [], recordRequestCheckpoint: async () => {} } as unknown as ConversationTracker;
  const orchestrator = createRequestOrchestrator({ pipedrive, journal: createRequestJournal(tracker),
    email: { sendLeadNotification: async () => {}, sendSupportNotification: async () => {}, sendBypassNotification: async () => {} },
    bypass: { enabled: false, recipients: [] }, opportunityRecipient: 'test@example.invalid',
  });
  for (const input of captured) {
    const first = await orchestrator.execute(input);
    const duplicate = await orchestrator.execute(input);
    assert.deepEqual(first.crm, duplicate.crm, 'Retry changed CRM identity');
    const personId = first.crm?.personId;
    const dealId = first.crm?.dealId;
    assert(personId && dealId, 'No reviewable CRM person/deal');
    // Save IDs immediately, even if subsequent schema assertions fail.
    crmEvidence.push({ requestId: input.requestId, personId, dealId, url: `${config.pipedriveWebBaseUrl}/deal/${dealId}` });
    await writeFile(resolve(outputDir, 'crm-readback.json'), JSON.stringify(crmEvidence, null, 2));
    const [person, deal, notes] = await Promise.all([pd(`/persons/${personId}`), pd(`/deals/${dealId}`), pd(`/notes?deal_id=${dealId}`)]);
    assert(person.email.some((item: any) => item.value === (input.leadData ?? input.supportData)!.email));
    assert.equal(deal.pipeline_id, config.pipedrivePipelineId);
    assert.equal(deal.stage_id, config.pipedriveStageId);
    assert.equal(Number(typeof deal.user_id === 'object' ? deal.user_id.id : deal.user_id), 24093350);
    assert.equal(Number(deal['300c5e3ef98a1a25e2f80262af2bd0942b95c231']), 177);
    assert.match(String(deal['eaf2557e218e842227f803c4abdc665291c99b91']), /^\d{4}-\d{2}-\d{2}/);
    assert.equal(Number(person['43c2a08a7993307990ced6639183ca91f7608b2b']), 152);
    assert.equal(Number(person['e0cb479c4f405997f2e53b58ddc84ecb6d4c7b49']), 140);
    const submitted = input.leadData ?? input.supportData!;
    if (submitted.phone) assert(person.phone.some((item: any) => String(item.value).replace(/\D/g, '').replace(/^00/, '') === submitted.phone!.replace(/\D/g, '').replace(/^00/, '')));
    else assert(!person.phone?.some((item: any) => Boolean(item.value)), 'Email-only contact acquired a phone number');
    if (input.leadData) {
      for (const [key, value] of Object.entries({ aff4a71d003cb374585aeef67732b05828b62050: 118, '36241991692b59873ce73c478b98aab6ad4054c1': 121, '9c08a82b8cad15eab222f89a6a961c59bc8c95e3': 122, '684a7860061d276f4a76498fd1653d721e37cb6f': 128, '59745cb0d3eb04f89e70543d01f49813175ad6a3': 56 })) assert.equal(Number(deal[key]), value, `Field ${key}`);
      assert(String(person['2f068d0e83a4ea944b6f91f97769a45557b62425']).includes('32657'));
    }
    const requestNotes = notes.filter((note: any) => note.content?.includes(input.requestId));
    assert.equal(requestNotes.length, 1, 'Expected one full transcript note');
    assert(requestNotes[0].content.includes((input.leadData ?? input.supportData)!.email));
    const scenario = scenarios.find((scenario) => input.requestId.endsWith(`-${scenario.id}`))!;
    for (const term of scenario.terms) assert(requestNotes[0].content.includes(term), `Stored note lost ${term}`);
    console.log(JSON.stringify({ crmReadback: 'passed', requestId: input.requestId, personId, dealId }));
  }
}
await writeFile(resolve(outputDir, 'result.json'), JSON.stringify({ runId, conversations: captured.length, crmWritesEnabled: live, crmEvidence, emailsSent: 0, result: 'passed' }, null, 2));
console.log(JSON.stringify({ result: 'passed', outputDir, conversations: captured.length, crmReadbacks: crmEvidence.length, emailsSent: 0 }));
