import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEmailRecipients } from '../src/email/recipients.js';
import {
  buildRunUniquePhone,
  shouldRetryChatAttempt,
} from './live-request-routing-helpers.js';

type Json = Record<string, unknown>;
type CaseResult = {
  useCase: string;
  subject: string;
  requestId: string;
  sessionId: string;
  expected: string;
  primaryRecipient: string;
  expectedRecipients: string[];
  events: Json[];
  completed: boolean;
  attempts: number;
};

const confirm = process.env.LIVE_E2E_CONFIRM;
if (confirm !== 'YES') throw new Error('Refusing live writes. Set LIVE_E2E_CONFIRM=YES.');
const apiKey = process.env.PIPEDRIVE_API_KEY;
if (!apiKey) throw new Error('PIPEDRIVE_API_KEY is required');

const baseUrl = (process.env.LIVE_E2E_BASE_URL || 'http://187.124.16.6:8085').replace(/\/$/, '');
const runId = process.env.LIVE_E2E_RUN_ID || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const outputDir = resolve(process.cwd(), 'output', `request-routing-${runId}`);
const pdBase = 'https://api.pipedrive.com/v1';
const internalRecipients = ['berg@lippelift.de', 'caechma@gmail.com'];

async function assertHealthy(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/health`);
  const health = await response.json() as {
    status?: string;
    pipedrive?: boolean;
    email?: boolean;
    conversationTracking?: boolean;
  };
  if (!response.ok || health.status !== 'ok' || !health.pipedrive || !health.email || !health.conversationTracking) {
    throw new Error(`Live health preflight failed: ${JSON.stringify(health)}`);
  }
}

async function pd<T>(path: string, init?: RequestInit): Promise<T> {
  const join = path.includes('?') ? '&' : '?';
  const response = await fetch(`${pdBase}${path}${join}api_token=${encodeURIComponent(apiKey!)}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const payload = await response.json() as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !payload.success) throw new Error(`Pipedrive ${path}: ${response.status} ${payload.error || response.statusText}`);
  return payload.data as T;
}

async function create(path: string, body: Json): Promise<number> {
  const data = await pd<{ id: number }>(path, { method: 'POST', body: JSON.stringify(body) });
  return data.id;
}

async function factoryFieldKey(): Promise<string> {
  const fields = await pd<Array<{ key: string; name: string }>>('/dealFields?limit=500');
  const matches = fields.filter((field) => field.name === 'Fabriknummer');
  if (matches.length !== 1) throw new Error(`Expected one Fabriknummer field, found ${matches.length}`);
  return matches[0].key;
}

const created = { people: [] as number[], deals: [] as number[] };
async function fixturePerson(name: string, email?: string, phone?: string): Promise<number> {
  const id = await create('/persons', {
    name,
    ...(email ? { email: [{ value: email, primary: true }] } : {}),
    ...(phone ? { phone: [{ value: phone, primary: true }] } : {}),
    visible_to: 3,
  });
  created.people.push(id);
  return id;
}

async function fixtureDeal(title: string, personId: number, extra: Json = {}): Promise<number> {
  const id = await create('/deals', {
    title,
    person_id: personId,
    pipeline_id: 1,
    stage_id: 2,
    value: 0,
    currency: 'EUR',
    status: 'open',
    visible_to: 3,
    ...extra,
  });
  created.deals.push(id);
  return id;
}

function subject(useCase: string, label: string): string {
  return `[LIPPEBOT E2E][${useCase}][${runId}] ${label}`;
}

function leadMessage(useCase: string, label: string, input: {
  name: string; email: string; phone?: string; prior: 'ja' | 'nein'; reference?: string;
}): string {
  const [firstName, ...last] = input.name.split(' ');
  return [
    'Ich besitze noch keinen Lift und moechte verbindlich eine Anfrage absenden.',
    `Test-Betreff/Anliegen: ${subject(useCase, label)}.`,
    `Name: ${firstName} ${last.join(' ')}.`,
    `E-Mail: ${input.email}.`,
    input.phone ? `Telefon: ${input.phone}.` : '',
    `Bereits mit einem Mitarbeiter gesprochen: ${input.prior}.`,
    input.reference ? `Referenz: ${input.reference}.` : '',
    'Kundensegment Privatperson. Treppe innen und gerade. Einfamilienhaus. Gewuenscht ist ein Sitzlift.',
    'Adresse: E2E Testweg 21, 32756 Detmold. Erreichbar werktags 09:00 bis 12:00 Uhr.',
    'Alle Pflichtangaben sind vorhanden. Bitte jetzt absenden und das submit_lead Tool aufrufen.',
  ].filter(Boolean).join(' ');
}

function serviceMessage(useCase: string, label: string, input: {
  name: string; email: string; manufacturer: 'LIPPE' | 'Fremdhersteller';
  kind: string; factory?: string; unavailable?: boolean; prior?: 'ja' | 'nein' | 'unbekannt'; reference?: string;
}): string {
  return [
    'Ich besitze bereits einen Lift und moechte verbindlich eine Serviceanfrage absenden.',
    `Der Lift ist von ${input.manufacturer}.`,
    input.factory ? `Fabriknummer: ${input.factory}.` : '',
    input.unavailable ? 'Die Fabriknummer ist nicht verfuegbar.' : '',
    `Anfrageart: ${input.kind}.`,
    `Bereits mit uns gesprochen oder geschrieben: ${input.prior ?? 'nein'}.`,
    input.reference ? `Referenz: ${input.reference}.` : '',
    `Kundenname: ${input.name}. E-Mail: ${input.email}.`,
    `Problembeschreibung und Test-Betreff: ${subject(useCase, label)}.`,
    'Alle Pflichtangaben sind vorhanden. Bitte jetzt absenden und das submit_service_request Tool aufrufen.',
  ].filter(Boolean).join(' ');
}

async function chat(useCase: string, label: string, message: string, expected: string, primaryRecipient: string, options: { sessionId?: string; requestId?: string } = {}): Promise<CaseResult> {
  const requestId = options.requestId || `e2e-${useCase}-${runId}-${label.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`;
  const sessionId = options.sessionId || `e2e-session-${useCase}-${runId}`;
  const expectedRecipients = primaryRecipient === 'none'
    ? []
    : parseEmailRecipients(primaryRecipient, ...internalRecipients);
  const maxAttempts = Math.max(1, Number(process.env.LIVE_E2E_CHAT_ATTEMPTS || 4));
  const retryDelayMs = Math.max(0, Number(process.env.LIVE_E2E_RETRY_DELAY_MS || 10_000));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, requestId, message, history: [] }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${useCase} HTTP ${response.status}: ${raw}`);
    const events = raw.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)) as Json);
    const completed = events.some((event) => event.type === 'action' && event.action === 'request_completed');
    const result = { useCase, subject: subject(useCase, label), requestId, sessionId, expected, primaryRecipient, expectedRecipients, events, completed, attempts: attempt };
    if (!shouldRetryChatAttempt(events, completed, primaryRecipient !== 'none', attempt, maxAttempts)) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt));
  }

  throw new Error(`${useCase} exhausted chat attempts`);
}

async function main(): Promise<void> {
  await assertHealthy();
  await mkdir(outputDir, { recursive: true });
  const field = await factoryFieldKey();
  const suffix = runId.slice(-8);
  const uniquePhone = buildRunUniquePhone(runId, 2);
  const priorPhone = buildRunUniquePhone(runId, 3);

  const uniqueName = `Eetwo Unique ${suffix}`;
  const uniqueEmail = `e2e.unique.${runId}@example.invalid`;
  const uniquePerson = await fixturePerson(uniqueName, uniqueEmail, uniquePhone);
  const uniqueDeal = await fixtureDeal(`E2E existing opportunity UC02 ${runId}`, uniquePerson);

  const priorName = `Eetwo Prior ${suffix}`;
  const priorEmail = `e2e.prior.${runId}@example.invalid`;
  const priorPerson = await fixturePerson(priorName, priorEmail, priorPhone);
  const priorDeal = await fixtureDeal(`E2E prior opportunity UC03 ${runId}`, priorPerson);

  const ambiguousName = `Eetwo Ambiguous ${suffix}`;
  const ambiguousPeople = await Promise.all([
    fixturePerson(ambiguousName, `e2e.amb.a.${runId}@example.invalid`),
    fixturePerson(ambiguousName, `e2e.amb.b.${runId}@example.invalid`),
  ]);
  await Promise.all(ambiguousPeople.map((personId, index) => fixtureDeal(`E2E ambiguous ${index + 1} ${runId}`, personId)));

  async function factoryFixture(code: string, label: string): Promise<{ personId: number; dealId: number }> {
    const personId = await fixturePerson(`Eetwo Factory ${label} ${suffix}`, `e2e.factory.${label.toLowerCase()}.${runId}@example.invalid`);
    const dealId = await fixtureDeal(`E2E source ${label} ${runId}`, personId, { [field]: code });
    return { personId, dealId };
  }

  const factory = {
    maintenance: `E2E-M-${runId}`,
    repair: `E2E-R-${runId}`,
    technical: `E2E-T-${runId}`,
    invoice: `E2E-F-${runId}`,
    sales: `E2E-S-${runId}`,
    afterSales: `E2E-A-${runId}`,
    duplicate: `E2E-D-${runId}`,
  };
  const sourceCases: Record<string, { personId: number; dealId: number }> = {};
  for (const [key, code] of Object.entries(factory).filter(([key]) => key !== 'duplicate')) {
    sourceCases[key] = await factoryFixture(code, key);
  }
  const duplicateA = await factoryFixture(factory.duplicate, 'duplicate-a');
  const duplicateB = await factoryFixture(factory.duplicate, 'duplicate-b');

  const results: CaseResult[] = [];
  results.push(await chat('UC-01', 'new opportunity', leadMessage('UC-01', 'new opportunity', {
    name: `Eetwo New ${suffix}`, email: `e2e.new.${runId}@example.invalid`, prior: 'nein',
  }), 'create one opportunity', 'sales@lippelift.de'));
  results.push(await chat('UC-02', 'reuse unique opportunity', leadMessage('UC-02', 'reuse unique opportunity', {
    name: uniqueName, email: uniqueEmail, phone: uniquePhone, prior: 'nein',
  }), `reuse deal ${uniqueDeal}`, 'sales@lippelift.de'));
  results.push(await chat('UC-03', 'reuse prior contact', leadMessage('UC-03', 'reuse prior contact', {
    name: priorName, email: priorEmail, phone: priorPhone, prior: 'ja', reference: `E2E prior opportunity UC03 ${runId}`,
  }), `reuse deal ${priorDeal}`, 'sales@lippelift.de'));
  results.push(await chat('UC-04', 'prior contact no case', leadMessage('UC-04', 'prior contact no case', {
    name: `Eetwo Missing ${suffix}`, email: `e2e.missing.${runId}@example.invalid`, prior: 'ja', reference: `NOCASE-${runId}`,
  }), 'email only; no CRM mutation', 'sales@lippelift.de'));
  results.push(await chat('UC-05', 'ambiguous identity', leadMessage('UC-05', 'ambiguous identity', {
    name: ambiguousName, email: `e2e.amb.none.${runId}@example.invalid`, prior: 'nein',
  }), 'email only; manual identity review', 'sales@lippelift.de'));
  results.push(await chat('UC-06', 'third party technical', serviceMessage('UC-06', 'third party technical', {
    name: `Eetwo Thirdparty ${suffix}`, email: `e2e.third.${runId}@example.invalid`, manufacturer: 'Fremdhersteller', kind: 'technische Stoerung',
  }), 'email only; no CRM mutation', 'technik@lippelift.de'));
  results.push(await chat('UC-07', 'factory unavailable', serviceMessage('UC-07', 'factory unavailable', {
    name: `Eetwo Unavailable ${suffix}`, email: `e2e.unavailable.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'technische Frage', unavailable: true,
  }), 'email only; no CRM mutation', 'technik@lippelift.de'));
  results.push(await chat('UC-08', 'duplicate factory', serviceMessage('UC-08', 'duplicate factory', {
    name: `Eetwo Duplicate ${suffix}`, email: `e2e.duplicate.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'technische Stoerung', factory: factory.duplicate,
  }), 'email only; ambiguous factory; no CRM mutation', 'technik@lippelift.de'));
  results.push(await chat('UC-09', 'maintenance read only', serviceMessage('UC-09', 'maintenance read only', {
    name: `Eetwo Maintenance ${suffix}`, email: `e2e.maintenance.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'Wartungsanfrage', factory: factory.maintenance,
  }), `email only; source deal ${sourceCases.maintenance.dealId}`, 'technik@lippelift.de'));
  results.push(await chat('UC-10', 'repair read only', serviceMessage('UC-10', 'repair read only', {
    name: `Eetwo Repair ${suffix}`, email: `e2e.repair.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'Reparaturanfrage', factory: factory.repair,
  }), `email only; source deal ${sourceCases.repair.dealId}`, 'technik@lippelift.de'));
  results.push(await chat('UC-11', 'technical service deal', serviceMessage('UC-11', 'technical service deal', {
    name: `Eetwo Technical ${suffix}`, email: `e2e.technical.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'technische Stoerung', factory: factory.technical,
  }), `create Serviceanfrage from ${sourceCases.technical.dealId}`, 'technik@lippelift.de'));
  results.push(await chat('UC-12', 'invoice service deal', serviceMessage('UC-12', 'invoice service deal', {
    name: `Eetwo Invoice ${suffix}`, email: `e2e.invoice.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'Rechnung und Zahlung', factory: factory.invoice,
  }), `create Serviceanfrage from ${sourceCases.invoice.dealId}`, 'finance@lippelift.de'));
  results.push(await chat('UC-13', 'sales service deal', serviceMessage('UC-13', 'sales service deal', {
    name: `Eetwo Sales ${suffix}`, email: `e2e.sales.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'Vertrag und Auftrag', factory: factory.sales,
  }), `create Serviceanfrage from ${sourceCases.sales.dealId}`, 'sales@lippelift.de'));
  results.push(await chat('UC-14', 'after sales service deal', serviceMessage('UC-14', 'after sales service deal', {
    name: `Eetwo Aftersales ${suffix}`, email: `e2e.aftersales.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'Ersatzteil und Gewaehrleistung', factory: factory.afterSales,
  }), `create Serviceanfrage from ${sourceCases.afterSales.dealId}`, 'lossau@lippelift.de'));

  const sharedSession = `e2e-session-UC-15-${runId}`;
  results.push(await chat('UC-15', 'concern A opportunity', leadMessage('UC-15', 'concern A opportunity', {
    name: `Eetwo Multi ${suffix}`, email: `e2e.multi.${runId}@example.invalid`, prior: 'nein',
  }), 'first independent outcome', 'sales@lippelift.de', { sessionId: sharedSession, requestId: `e2e-UC-15-${runId}-a` }));
  results.push(await chat('UC-15', 'concern B third party repair', serviceMessage('UC-15', 'concern B third party repair', {
    name: `Eetwo Multi ${suffix}`, email: `e2e.multi.${runId}@example.invalid`, manufacturer: 'Fremdhersteller', kind: 'Reparaturanfrage',
  }), 'second independent outcome', 'technik@lippelift.de', { sessionId: sharedSession, requestId: `e2e-UC-15-${runId}-b` }));

  const retryRequestId = `e2e-UC-16-${runId}-retry`;
  const retryMessage = serviceMessage('UC-16', 'idempotent retry', {
    name: `Eetwo Retry ${suffix}`, email: `e2e.retry.${runId}@example.invalid`, manufacturer: 'LIPPE', kind: 'technische Stoerung', factory: factory.technical,
  });
  results.push(await chat('UC-16', 'idempotent retry', retryMessage, 'one CRM case and one email across retries', 'technik@lippelift.de', { requestId: retryRequestId }));
  results.push(await chat('UC-16', 'idempotent retry', retryMessage, 'duplicate request reuses completed checkpoints', 'technik@lippelift.de', { requestId: retryRequestId }));
  results.push(await chat('UC-17', 'emergency interrupt', `Ich bin im Lift eingeschlossen. ${subject('UC-17', 'emergency interrupt')}`, '112 and company number; no CRM/email completion', 'none'));

  const artifact = {
    runId,
    baseUrl,
    createdAt: new Date().toISOString(),
    fixtures: { ...created, sourceCases, duplicateDeals: [duplicateA.dealId, duplicateB.dealId], factory },
    results,
  };
  await writeFile(resolve(outputDir, 'chat-results.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  const failures = results.filter((result) => result.useCase !== 'UC-17' && !result.completed);
  if (!results.find((result) => result.useCase === 'UC-17')?.events.some((event) => String(event.content || '').includes('112'))) {
    failures.push(results.find((result) => result.useCase === 'UC-17')!);
  }
  console.log(JSON.stringify({ runId, outputDir, cases: results.length, failures: failures.map((item) => item.subject) }, null, 2));
  if (failures.length) process.exitCode = 1;
}

await main();
