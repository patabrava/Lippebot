/** Real-model intake validation with all CRM, mail and tracking writes disabled.
 * Run with the usual Vertex environment and `npx tsx scripts/stress-intake-context.ts`.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createChatRoute } from '../src/routes/chat.js';
import { createGeminiService } from '../src/services/gemini.js';
import type { PipedriveService } from '../src/services/pipedrive.js';
import type { EmailService } from '../src/services/email.js';
import type { RequestExecutionInput } from '../src/request/request-orchestrator.js';
import type { ChatMessage, SSEEvent } from '../src/types/index.js';
import { loadConfig } from '../src/config/index.js';
import { buildNextMissingQuestion } from '../src/request/intake-verification.js';
import { stl300Inquiry, stl300Clarification } from '../tests/fixtures/stl300-inquiry.js';

const config = loadConfig();
const gemini = createGeminiService({ projectId: config.vertexAiProjectId, location: config.vertexAiLocation, apiKey: config.vertexAiApiKey, enabled: config.vertexAiEnabled });
const completed: RequestExecutionInput[] = [];
const disabledSideEffects = new Proxy({}, { get: (_target, property) => {
  if (property === 'isConfigured') return () => false;
  return () => { throw new Error(`Unexpected side effect: ${String(property)}`); };
} });
const app = createChatRoute({
  gemini,
  pipedrive: disabledSideEffects as PipedriveService,
  email: disabledSideEffects as EmailService,
  notificationEmailTo: '', serviceEmailTo: '',
  requestOrchestrator: { execute: async (input) => {
    completed.push(input);
    return { requestId: input.requestId, kind: input.leadData ? 'opportunity' : 'service', completed: true, recipient: 'test@example.invalid' };
  } },
});

const starters = [
  stl300Inquiry,
  stl300Clarification,
  'Für ein Bauprojekt plane ich einen neuen Hublift STL300. Ich brauche eine bemaßte DWG mit Außenmaßen und Montageabständen. Der verfügbare Platz beträgt 1.820 × 1.450 mm.',
];
function answer(text: string, phone: boolean): string {
  if (/Sind alle Angaben korrekt|Stimmt das so/i.test(text)) return 'Ja';
  if (/Hattest du wegen dieses Anliegens/i.test(text)) return 'Nein';
  if (/neuen Lift, einen bereits bestellten/i.test(text)) return 'einen neuen lift';
  if (/Namen.*E-Mail.*Telefon/i.test(text)) return phone ? 'Alex Beispiel, test@example.de, Telefon: 05261 5550123' : 'Alex Beispiel, test@example.de. Bitte nur per E-Mail.';
  if (/vollständiger Name|Wie ist dein Name/i.test(text)) return 'Alex Beispiel';
  if (/E-Mail-Adresse und Telefonnummer/i.test(text)) return phone ? 'test@example.de, Telefon: 05261 5550123' : 'test@example.de';
  if (/Wie lautet deine Telefonnummer/i.test(text)) return 'nur per email bitte';
  if (/Wie lautet deine E-Mail-Adresse/i.test(text)) return 'test@example.de';
  if (/drinnen oder draußen|innen oder außen/i.test(text)) return 'draußen';
  if (/gerade oder kurvig/i.test(text)) return 'Es geht um einen vertikalen Hublift, keine Treppe.';
  if (/Sitzlift oder.*rollstuhl/i.test(text)) return 'rollstuhlgeeignet';
  if (/Einfamilienhaus oder.*Mehrfamilienhaus/i.test(text)) return 'Mehrfamilienhaus';
  if (/private Anfrage oder.*geschäftlich/i.test(text)) return 'geschäftlich';
  if (/vollständigen? Adresse|An welcher.*Adresse/i.test(text)) return 'Musterstraße 4, 80331 München';
  if (/Wann bist du.*erreichbar/i.test(text)) return '08:00–12:00';
  throw new Error(`Unrecognized or repeated prompt: ${text}`);
}

async function runScenario(index: number): Promise<void> {
  const phone = index % 2 === 1;
  const requestId = `isolated-intake-${Date.now()}-${index}`;
  const history: ChatMessage[] = [];
  let message = starters[Math.floor(index / 2)];
  let finished = false;
  let previousMissing: string | undefined;
  for (let turn = 0; turn < 18; turn += 1) {
    const response = await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: requestId, requestId, message, history }) });
    const events: SSEEvent[] = (await response.text()).split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
    assert(!events.some((event) => event.type === 'error'), 'Model/API error');
    const text = events.filter((event) => event.type === 'token').map((event) => event.content).join('');
    assert(!/Beschreibe mir bitte kurz|Ich knüpfe an deine bisherigen Angaben|Ich meinte damit/i.test(text), `Inquiry loop: ${text}`);
    assert(!/Fabriknummer|bereits eingebaut/i.test(text.replace('einen bereits eingebauten Lift', '')), `Wrong existing-lift branch: ${text}`);
    const data = events.find((event) => event.type === 'done')?.collectedData;
    assert(data?.message?.includes('1.820 × 1.450'), 'Project dimensions lost');
    assert(data?.message?.includes('DWG'), 'Drawing request lost');
    const done = events.find((event) => event.type === 'done');
    const nextMissing = done ? buildNextMissingQuestion(done.mode!, data ?? {}) : undefined;
    const isCompleted = events.some((event) => event.action === 'request_completed');
    assert(isCompleted || nextMissing !== previousMissing, `Answered field requested again: ${nextMissing}`);
    previousMissing = nextMissing;
    console.log(JSON.stringify({ scenario: index + 1, turn: turn + 1, response: text, mode: done?.mode, nextMissing, fields: Object.keys(data ?? {}) }));
    history.push({ role: 'user', content: message, timestamp: Date.now() }, { role: 'assistant', content: text, timestamp: Date.now() });
    if (events.some((event) => event.action === 'request_completed')) { finished = true; break; }
    // Use the canonical backend field prompt to drive the synthetic customer,
    // allowing natural model paraphrases while still rejecting repeated fields.
    message = answer(/Sind alle Angaben korrekt/i.test(text) ? text : nextMissing ?? text, phone);
  }
  assert(finished, `Scenario ${index + 1} did not complete`);
  const handoff = completed.find((input) => input.requestId === requestId)!;
  assert(handoff.leadData, 'New lift was handed off as existing-lift service');
  assert(handoff.leadData.message?.includes('DWG'), 'Handoff lost customer request');
  console.log(JSON.stringify({ scenario: index + 1, result: 'passed', turns: history.length / 2 }));
}
for (let index = 0; index < starters.length * 2; index += 2) {
  await Promise.all([runScenario(index), runScenario(index + 1)]);
}
console.log(JSON.stringify({ result: 'passed', completedScenarios: completed.length, externalWrites: 0 }));
