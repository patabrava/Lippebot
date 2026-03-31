# Sarah Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Sarah," a German-speaking AI chatbot widget for LippeLift's Webflow site that advises on stairlifts, captures leads to Pipedrive, and routes service requests via email.

**Architecture:** A TypeScript monorepo with two packages — `backend` (Hono server on VPS with Gemini API, Pipedrive, and email integration) and `widget` (lightweight JS chat bubble embedded via script tag). The backend streams responses via SSE. Gemini handles mode detection and data extraction via function calling alongside its streamed text response.

**Tech Stack:** Node.js, TypeScript, Hono, @google/generative-ai, Nodemailer, Vite (widget bundler), Vitest (tests), Docker + nginx (deployment)

**Spec:** `docs/superpowers/specs/2026-03-31-sarah-chatbot-design.md`

---

## Task 1: Project Scaffolding — Backend

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.env.example`
- Create: `backend/src/index.ts`

- [ ] **Step 1: Initialize backend package**

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
mkdir -p backend/src
```

Write `backend/package.json`:
```json
{
  "name": "sarah-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google/generative-ai": "^0.24.0",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0",
    "nodemailer": "^6.10.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/nodemailer": "^6.4.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create .env.example**

Write `backend/.env.example`:
```env
# Gemini
GEMINI_API_KEY=your-gemini-api-key

# Pipedrive (pending)
PIPEDRIVE_API_KEY=your-pipedrive-api-key
PIPEDRIVE_PIPELINE_ID=1
PIPEDRIVE_STAGE_ID=1

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=sarah@lippelift.de
SMTP_PASS=your-smtp-password
NOTIFICATION_EMAIL_TO=info@lippelift.de
SERVICE_EMAIL_TO=service@lippelift.de

# Server
PORT=3000
CORS_ORIGIN=https://www.lippelift.de
NODE_ENV=development
```

- [ ] **Step 4: Create minimal server entry point**

Write `backend/src/index.ts`:
```typescript
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use('/api/*', cors({ origin: corsOrigin }));

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '1.0.0' });
});

const port = parseInt(process.env.PORT || '3000', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sarah backend running on http://localhost:${info.port}`);
});

export default app;
```

- [ ] **Step 5: Install dependencies and verify server starts**

```bash
cd backend && npm install
npx tsx src/index.ts &
sleep 2
curl http://localhost:3000/api/health
# Expected: {"status":"ok","version":"1.0.0"}
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/.env.example backend/src/index.ts backend/package-lock.json
git commit -m "feat: scaffold backend with Hono server and health endpoint"
```

---

## Task 2: Backend Types

**Files:**
- Create: `backend/src/types/index.ts`

- [ ] **Step 1: Write types file**

Write `backend/src/types/index.ts`:
```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  history: ChatMessage[];
}

export type Mode = 'berater' | 'anfrage' | 'service' | 'undetermined';

export interface LeadData {
  stairLocation?: 'innen' | 'aussen';
  stairType?: 'gerade' | 'kurvig';
  buildingType?: 'einfamilienhaus' | 'mehrfamilienhaus';
  liftType?: 'sitzlift' | 'rollstuhlgeeignet';
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  availability?: '08:00 - 12:00' | '12:00 - 16:00' | '16:00 - 20:00';
  message?: string;
  newsletter?: 'Ja' | 'Nein';
}

export interface ServiceData {
  customerName?: string;
  phone?: string;
  email?: string;
  issueDescription?: string;
  liftModel?: string;
}

export interface ConversationState {
  sessionId: string;
  mode: Mode;
  collectedData: Partial<LeadData & ServiceData>;
}

export interface SSEEvent {
  type: 'token' | 'done' | 'action' | 'error';
  content?: string;
  mode?: Mode;
  collectedData?: Partial<LeadData & ServiceData>;
  action?: string;
  data?: Record<string, unknown>;
  error?: string;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd backend && npx tsc --noEmit src/types/index.ts
# Expected: no errors
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat: add TypeScript types for chat, leads, and service data"
```

---

## Task 3: Backend Config

**Files:**
- Create: `backend/src/config/index.ts`

- [ ] **Step 1: Write config loader**

Write `backend/src/config/index.ts`:
```typescript
import { z } from 'zod';

const configSchema = z.object({
  geminiApiKey: z.string().min(1),
  pipedriveApiKey: z.string().default(''),
  pipedrivePipelineId: z.coerce.number().default(1),
  pipedriveStageId: z.coerce.number().default(1),
  smtpHost: z.string().default(''),
  smtpPort: z.coerce.number().default(587),
  smtpUser: z.string().default(''),
  smtpPass: z.string().default(''),
  notificationEmailTo: z.string().default(''),
  serviceEmailTo: z.string().default(''),
  port: z.coerce.number().default(3000),
  corsOrigin: z.string().default('http://localhost:5173'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    geminiApiKey: process.env.GEMINI_API_KEY,
    pipedriveApiKey: process.env.PIPEDRIVE_API_KEY,
    pipedrivePipelineId: process.env.PIPEDRIVE_PIPELINE_ID,
    pipedriveStageId: process.env.PIPEDRIVE_STAGE_ID,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    notificationEmailTo: process.env.NOTIFICATION_EMAIL_TO,
    serviceEmailTo: process.env.SERVICE_EMAIL_TO,
    port: process.env.PORT,
    corsOrigin: process.env.CORS_ORIGIN,
    nodeEnv: process.env.NODE_ENV,
  });
}
```

- [ ] **Step 2: Write test for config**

Create `backend/tests/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config/index.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if GEMINI_API_KEY is missing', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => loadConfig()).toThrow();
  });

  it('loads config with defaults when only GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const config = loadConfig();
    expect(config.geminiApiKey).toBe('test-key');
    expect(config.port).toBe(3000);
    expect(config.corsOrigin).toBe('http://localhost:5173');
    expect(config.pipedriveApiKey).toBe('');
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd backend && npx vitest run tests/config.test.ts
# Expected: 2 tests pass
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/config/index.ts backend/tests/config.test.ts
git commit -m "feat: add config loader with Zod validation"
```

---

## Task 4: System Prompt + Knowledge Base

**Files:**
- Create: `backend/src/prompts/system-prompt.ts`

- [ ] **Step 1: Write system prompt builder**

Write `backend/src/prompts/system-prompt.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedKnowledgeBase: string | null = null;

function loadKnowledgeBase(): string {
  if (cachedKnowledgeBase) return cachedKnowledgeBase;
  const kbPath = resolve(import.meta.dirname, '../../../Knowledge_Base_LippeLift.txt');
  cachedKnowledgeBase = readFileSync(kbPath, 'utf-8');
  return cachedKnowledgeBase;
}

export function buildSystemPrompt(): string {
  const knowledgeBase = loadKnowledgeBase();

  return `Du bist Sarah, die freundliche und kompetente KI-Beraterin von LIPPE Lift GmbH.

## Deine Persönlichkeit
- Du sprichst ausschließlich Deutsch
- Du bist warm, vertrauenswürdig, empathisch und lösungsorientiert
- Du bist NICHT aufdringlich oder pushy
- Du duzt die Kunden NICHT — du siezt sie immer
- Du verwendest eine verständliche, menschliche Sprache

## Deine drei Modi

### Berater-Modus
Wenn der Nutzer Fragen zu Produkten, Förderungen, dem Einbauprozess oder technischen Details hat.
Nutze die Wissensdatenbank unten, um fundierte Antworten zu geben.

### Anfrage-Modus
Wenn der Nutzer eine Beratung oder ein Angebot anfordern möchte.
Sammle die folgenden Informationen natürlich im Gespräch (NICHT als starre Abfrage):
- Treppenstandort: Innentreppe oder Außentreppe
- Treppenverlauf: Gerade oder Kurvig
- Gebäudetyp: Einfamilienhaus oder Mehrfamilienhaus
- Lifttyp: Sitzlift oder Rollstuhlgeeignet
- Vorname, Nachname, Telefonnummer (Pflicht)
- PLZ, Stadt (Pflicht)
- Erreichbarkeit: 08:00-12:00, 12:00-16:00, oder 16:00-20:00 (Pflicht)
- Straße, E-Mail, Nachricht, Newsletter (Optional)

Wenn alle Pflichtdaten gesammelt sind, rufe die Funktion \`submit_lead\` auf.
Bestätige dem Nutzer warmherzig, dass sich ein Berater innerhalb eines halben Tages melden wird.
Erwähne, dass die Erstberatung kostenlos und unverbindlich ist.

### Service-Modus
Wenn ein bestehender Kunde ein Problem, eine Wartungsanfrage oder eine Garantiefrage hat.
Sammle: Name, Telefonnummer, Problembeschreibung, ggf. Lift-Modell.
Versuche NIEMALS das Problem zu diagnostizieren oder zu beheben.
Wenn die Daten gesammelt sind, rufe die Funktion \`submit_service_request\` auf.
Versichere dem Kunden, dass sich das Service-Team zeitnah melden wird.

## Wichtige Regeln — NIEMALS:
- Preise nennen oder schätzen
- Direkte Vergleiche mit Wettbewerbern (Hiro, Liftstar, Lifta, TKE) anstellen
- Eingestellte Produkte erwähnen (LL12, Konstanz)
- Technische Probleme diagnostizieren oder Reparaturanleitungen geben
- Versprechen zu Lieferzeiten oder Verfügbarkeit machen
- Auf Englisch oder eine andere Sprache wechseln

## Wichtige Regeln — IMMER:
- Auf Deutsch antworten
- Bei jeder Gelegenheit erwähnen, dass die Erstberatung kostenlos und unverbindlich ist
- An einen Menschen übergeben für alles, was über Information und Datenerfassung hinausgeht
- Die Funktion \`report_state\` am Ende JEDER Antwort aufrufen

## Wissensdatenbank

${knowledgeBase}`;
}
```

- [ ] **Step 2: Write test for system prompt**

Create `backend/tests/system-prompt.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/prompts/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('includes Sarah personality', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Du bist Sarah');
  });

  it('includes knowledge base content', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('LIPPE Lift GmbH');
    expect(prompt).toContain('VARIO PLUS');
    expect(prompt).toContain('STL300');
  });

  it('includes all three modes', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Berater-Modus');
    expect(prompt).toContain('Anfrage-Modus');
    expect(prompt).toContain('Service-Modus');
  });

  it('includes boundary rules', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('Preise nennen');
    expect(prompt).toContain('LL12');
    expect(prompt).toContain('Konstanz');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd backend && npx vitest run tests/system-prompt.test.ts
# Expected: 4 tests pass
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/prompts/system-prompt.ts backend/tests/system-prompt.test.ts
git commit -m "feat: add German system prompt with knowledge base injection"
```

---

## Task 5: Gemini Service

**Files:**
- Create: `backend/src/services/gemini.ts`
- Create: `backend/tests/gemini.test.ts`

- [ ] **Step 1: Define Gemini function declarations (tools)**

Write `backend/src/services/gemini.ts`:
```typescript
import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  SchemaType,
  type GenerateContentRequest,
  type Content,
} from '@google/generative-ai';
import type { ChatMessage, Mode, LeadData, ServiceData, ConversationState } from '../types/index.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';

const reportStateFn: FunctionDeclaration = {
  name: 'report_state',
  description: 'Report the current conversation mode and any collected data after every response.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      mode: {
        type: SchemaType.STRING,
        enum: ['berater', 'anfrage', 'service', 'undetermined'],
        description: 'The current conversation mode',
      },
      collectedData: {
        type: SchemaType.OBJECT,
        description: 'Any lead or service data collected so far',
        properties: {
          stairLocation: { type: SchemaType.STRING },
          stairType: { type: SchemaType.STRING },
          buildingType: { type: SchemaType.STRING },
          liftType: { type: SchemaType.STRING },
          firstName: { type: SchemaType.STRING },
          lastName: { type: SchemaType.STRING },
          phone: { type: SchemaType.STRING },
          email: { type: SchemaType.STRING },
          street: { type: SchemaType.STRING },
          postalCode: { type: SchemaType.STRING },
          city: { type: SchemaType.STRING },
          availability: { type: SchemaType.STRING },
          message: { type: SchemaType.STRING },
          newsletter: { type: SchemaType.STRING },
          customerName: { type: SchemaType.STRING },
          issueDescription: { type: SchemaType.STRING },
          liftModel: { type: SchemaType.STRING },
        },
      },
    },
    required: ['mode'],
  },
};

const submitLeadFn: FunctionDeclaration = {
  name: 'submit_lead',
  description: 'Submit a qualified lead when all required contact information has been collected.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      stairLocation: { type: SchemaType.STRING },
      stairType: { type: SchemaType.STRING },
      buildingType: { type: SchemaType.STRING },
      liftType: { type: SchemaType.STRING },
      firstName: { type: SchemaType.STRING },
      lastName: { type: SchemaType.STRING },
      phone: { type: SchemaType.STRING },
      email: { type: SchemaType.STRING },
      street: { type: SchemaType.STRING },
      postalCode: { type: SchemaType.STRING },
      city: { type: SchemaType.STRING },
      availability: { type: SchemaType.STRING },
      message: { type: SchemaType.STRING },
      newsletter: { type: SchemaType.STRING },
    },
    required: ['firstName', 'lastName', 'phone', 'postalCode', 'city', 'availability'],
  },
};

const submitServiceRequestFn: FunctionDeclaration = {
  name: 'submit_service_request',
  description: 'Submit a service request when the customer has described their issue and provided contact info.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      customerName: { type: SchemaType.STRING },
      phone: { type: SchemaType.STRING },
      email: { type: SchemaType.STRING },
      issueDescription: { type: SchemaType.STRING },
      liftModel: { type: SchemaType.STRING },
    },
    required: ['customerName', 'phone', 'issueDescription'],
  },
};

export interface GeminiStreamResult {
  textStream: AsyncIterable<string>;
  getState: () => Promise<ConversationState | null>;
  getLeadData: () => Promise<LeadData | null>;
  getServiceData: () => Promise<ServiceData | null>;
}

export function createGeminiService(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: buildSystemPrompt(),
    tools: [{ functionDeclarations: [reportStateFn, submitLeadFn, submitServiceRequestFn] }],
  });

  async function* streamChat(
    sessionId: string,
    message: string,
    history: ChatMessage[],
  ): AsyncGenerator<{
    type: 'token' | 'state' | 'lead' | 'service';
    content?: string;
    state?: ConversationState;
    leadData?: LeadData;
    serviceData?: ServiceData;
  }> {
    const contents: Content[] = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    const result = await model.generateContentStream({ contents });

    for await (const chunk of result.stream) {
      // Handle text parts
      const text = chunk.text();
      if (text) {
        yield { type: 'token', content: text };
      }

      // Handle function calls
      const candidates = chunk.candidates;
      if (candidates) {
        for (const candidate of candidates) {
          for (const part of candidate.content.parts) {
            if (part.functionCall) {
              const { name, args } = part.functionCall;
              if (name === 'report_state') {
                yield {
                  type: 'state',
                  state: {
                    sessionId,
                    mode: (args as { mode: Mode }).mode,
                    collectedData: (args as { collectedData?: Record<string, unknown> }).collectedData || {},
                  },
                };
              } else if (name === 'submit_lead') {
                yield { type: 'lead', leadData: args as LeadData };
              } else if (name === 'submit_service_request') {
                yield { type: 'service', serviceData: args as ServiceData };
              }
            }
          }
        }
      }
    }
  }

  return { streamChat };
}

export type GeminiService = ReturnType<typeof createGeminiService>;
```

- [ ] **Step 2: Write unit test**

Create `backend/tests/gemini.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createGeminiService } from '../src/services/gemini.js';

describe('createGeminiService', () => {
  it('creates a service with streamChat method', () => {
    const service = createGeminiService('fake-key');
    expect(service).toHaveProperty('streamChat');
    expect(typeof service.streamChat).toBe('function');
  });
});
```

Note: Full integration tests require a real Gemini API key. This test validates the service factory pattern only. Live testing happens in Task 10.

- [ ] **Step 3: Run test**

```bash
cd backend && npx vitest run tests/gemini.test.ts
# Expected: 1 test passes
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/gemini.ts backend/tests/gemini.test.ts
git commit -m "feat: add Gemini service with streaming and function calling"
```

---

## Task 6: Pipedrive Service

**Files:**
- Create: `backend/src/services/pipedrive.ts`
- Create: `backend/tests/pipedrive.test.ts`

- [ ] **Step 1: Write test for Pipedrive service**

Create `backend/tests/pipedrive.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPipedriveService } from '../src/services/pipedrive.js';

describe('createPipedriveService', () => {
  it('returns noop service when API key is empty', () => {
    const service = createPipedriveService('', 1, 1);
    expect(service.isConfigured()).toBe(false);
  });

  it('returns configured service when API key is provided', () => {
    const service = createPipedriveService('test-key', 1, 1);
    expect(service.isConfigured()).toBe(true);
  });

  it('createLead builds correct person and deal payload', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '0123456789',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
      stairLocation: 'innen',
      stairType: 'kurvig',
      buildingType: 'einfamilienhaus',
      liftType: 'sitzlift',
    });

    expect(result).toEqual({ personId: 123, dealId: 456 });

    // Check person creation call
    const personCall = mockFetch.mock.calls[0];
    expect(personCall[0]).toContain('/persons');
    const personBody = JSON.parse(personCall[1].body);
    expect(personBody.name).toBe('Max Mustermann');
    expect(personBody.phone).toEqual([{ value: '0123456789', primary: true }]);

    // Check deal creation call
    const dealCall = mockFetch.mock.calls[1];
    expect(dealCall[0]).toContain('/deals');
    const dealBody = JSON.parse(dealCall[1].body);
    expect(dealBody.person_id).toBe(123);
    expect(dealBody.pipeline_id).toBe(2);
    expect(dealBody.stage_id).toBe(3);

    vi.unstubAllGlobals();
  });

  it('createServiceActivity builds correct activity payload', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 101 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 1);
    const result = await service.createServiceActivity({
      customerName: 'Maria Schmidt',
      phone: '0987654321',
      issueDescription: 'Lift macht Geräusche beim Hochfahren',
    });

    expect(result).toEqual({ personId: 789, activityId: 101 });

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run tests/pipedrive.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Write Pipedrive service**

Write `backend/src/services/pipedrive.ts`:
```typescript
import type { LeadData, ServiceData } from '../types/index.js';

const PIPEDRIVE_API_BASE = 'https://api.pipedrive.com/v1';

export function createPipedriveService(apiKey: string, pipelineId: number, stageId: number) {
  const configured = apiKey.length > 0;

  async function apiCall(endpoint: string, body: Record<string, unknown>): Promise<{ id: number }> {
    const response = await fetch(`${PIPEDRIVE_API_BASE}${endpoint}?api_token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Pipedrive API error: ${response.status} ${response.statusText}`);
    }
    const result = await response.json() as { success: boolean; data: { id: number } };
    if (!result.success) {
      throw new Error('Pipedrive API returned success: false');
    }
    return result.data;
  }

  async function createLead(data: LeadData): Promise<{ personId: number; dealId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const person = await apiCall('/persons', {
      name: `${data.firstName} ${data.lastName}`,
      phone: [{ value: data.phone, primary: true }],
      ...(data.email ? { email: [{ value: data.email, primary: true }] } : {}),
    });

    const dealNotes = [
      `Treppe: ${data.stairLocation || 'k.A.'}`,
      `Verlauf: ${data.stairType || 'k.A.'}`,
      `Gebäude: ${data.buildingType || 'k.A.'}`,
      `Lifttyp: ${data.liftType || 'k.A.'}`,
      `Adresse: ${data.street || ''} ${data.postalCode} ${data.city}`.trim(),
      `Erreichbarkeit: ${data.availability}`,
      data.message ? `Nachricht: ${data.message}` : '',
      `Newsletter: ${data.newsletter || 'k.A.'}`,
    ].filter(Boolean).join('\n');

    const deal = await apiCall('/deals', {
      title: `Sarah Lead: ${data.firstName} ${data.lastName}`,
      person_id: person.id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      visible_to: 3,
    });

    // Add note to deal
    await apiCall('/notes', {
      deal_id: deal.id,
      content: dealNotes,
      pinned_to_deal_flag: 1,
    }).catch(() => {}); // non-critical

    return { personId: person.id, dealId: deal.id };
  }

  async function createServiceActivity(data: ServiceData): Promise<{ personId: number; activityId: number }> {
    if (!configured) throw new Error('Pipedrive not configured');

    const person = await apiCall('/persons', {
      name: data.customerName,
      phone: [{ value: data.phone, primary: true }],
      ...(data.email ? { email: [{ value: data.email, primary: true }] } : {}),
    });

    const activity = await apiCall('/activities', {
      subject: `Service-Anfrage: ${data.issueDescription.substring(0, 80)}`,
      type: 'task',
      note: [
        `Problembeschreibung: ${data.issueDescription}`,
        data.liftModel ? `Lift-Modell: ${data.liftModel}` : '',
      ].filter(Boolean).join('\n'),
      person_id: person.id,
      done: 0,
    });

    return { personId: person.id, activityId: activity.id };
  }

  return {
    isConfigured: () => configured,
    createLead,
    createServiceActivity,
  };
}

export type PipedriveService = ReturnType<typeof createPipedriveService>;
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx vitest run tests/pipedrive.test.ts
# Expected: 4 tests pass
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pipedrive.ts backend/tests/pipedrive.test.ts
git commit -m "feat: add Pipedrive service for lead and service activity creation"
```

---

## Task 7: Email Service

**Files:**
- Create: `backend/src/services/email.ts`
- Create: `backend/tests/email.test.ts`

- [ ] **Step 1: Write test**

Create `backend/tests/email.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEmailService } from '../src/services/email.js';

describe('createEmailService', () => {
  it('returns unconfigured service when SMTP host is empty', () => {
    const service = createEmailService({ host: '', port: 587, user: '', pass: '' });
    expect(service.isConfigured()).toBe(false);
  });

  it('returns configured service when SMTP host is set', () => {
    const service = createEmailService({ host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' });
    expect(service.isConfigured()).toBe(true);
  });

  it('sendLeadNotification formats email correctly', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: '123' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '0123',
      city: 'Lemgo',
      postalCode: '32657',
      availability: '08:00 - 12:00',
      stairLocation: 'innen',
      stairType: 'kurvig',
      liftType: 'sitzlift',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('test@example.com');
    expect(call.subject).toContain('Max Mustermann');
    expect(call.html).toContain('Sitzlift');
    expect(call.html).toContain('Lemgo');
  });

  it('sendServiceNotification formats email correctly', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: '456' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendServiceNotification('service@example.com', {
      customerName: 'Maria Schmidt',
      phone: '0987',
      issueDescription: 'Lift macht Geräusche',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('service@example.com');
    expect(call.subject).toContain('Service-Anfrage');
    expect(call.html).toContain('Maria Schmidt');
    expect(call.html).toContain('Lift macht Geräusche');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx vitest run tests/email.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Write email service**

Write `backend/src/services/email.ts`:
```typescript
import nodemailer from 'nodemailer';
import type { LeadData, ServiceData } from '../types/index.js';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

interface MailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
}

type SendFn = (options: MailOptions) => Promise<unknown>;

export function createEmailService(smtp: SmtpConfig, sendOverride?: SendFn) {
  const configured = smtp.host.length > 0;

  let sendFn: SendFn;
  if (sendOverride) {
    sendFn = sendOverride;
  } else if (configured) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    sendFn = (options) => transporter.sendMail(options);
  } else {
    sendFn = async () => {};
  }

  const from = smtp.user || 'sarah@lippelift.de';

  async function sendLeadNotification(to: string, data: LeadData): Promise<void> {
    if (!configured && !sendOverride) return;

    const html = `
      <h2>Neue Anfrage über Sarah (Chatbot)</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Name:</td><td>${data.firstName} ${data.lastName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>
        ${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
        ${data.street ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Straße:</td><td>${data.street}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">PLZ / Stadt:</td><td>${data.postalCode} ${data.city}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Erreichbarkeit:</td><td>${data.availability}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Treppe:</td><td>${data.stairLocation || 'k.A.'} / ${data.stairType || 'k.A.'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Gebäude:</td><td>${data.buildingType || 'k.A.'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lifttyp:</td><td>${data.liftType === 'sitzlift' ? 'Sitzlift' : data.liftType === 'rollstuhlgeeignet' ? 'Rollstuhlgeeignet' : 'k.A.'}</td></tr>
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Nachricht:</td><td>${data.message}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Newsletter:</td><td>${data.newsletter || 'k.A.'}</td></tr>
      </table>
    `;

    await sendFn({
      from,
      to,
      subject: `Sarah Lead: ${data.firstName} ${data.lastName}`,
      html,
    });
  }

  async function sendServiceNotification(to: string, data: ServiceData): Promise<void> {
    if (!configured && !sendOverride) return;

    const html = `
      <h2>Service-Anfrage über Sarah (Chatbot)</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Kunde:</td><td>${data.customerName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>
        ${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
        ${data.liftModel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lift-Modell:</td><td>${data.liftModel}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Problem:</td><td>${data.issueDescription}</td></tr>
      </table>
    `;

    await sendFn({
      from,
      to,
      subject: `Service-Anfrage: ${data.customerName}`,
      html,
    });
  }

  return {
    isConfigured: () => configured,
    sendLeadNotification,
    sendServiceNotification,
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx vitest run tests/email.test.ts
# Expected: 4 tests pass
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/email.ts backend/tests/email.test.ts
git commit -m "feat: add email service for lead and service notifications"
```

---

## Task 8: Chat Route (SSE Streaming)

**Files:**
- Create: `backend/src/routes/chat.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write chat route**

Write `backend/src/routes/chat.ts`:
```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { GeminiService } from '../services/gemini.js';
import type { PipedriveService } from '../services/pipedrive.js';
import type { EmailService } from '../services/email.js';
import type { ChatMessage } from '../types/index.js';

const chatRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.number(),
  })).default([]),
});

interface ChatDeps {
  gemini: GeminiService;
  pipedrive: PipedriveService;
  email: EmailService;
  notificationEmailTo: string;
  serviceEmailTo: string;
}

export function createChatRoute(deps: ChatDeps): Hono {
  const app = new Hono();

  app.post('/api/chat', async (c) => {
    const body = await c.req.json();
    const parsed = chatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    }

    const { sessionId, message, history } = parsed.data;

    return streamSSE(c, async (stream) => {
      try {
        const gen = deps.gemini.streamChat(sessionId, message, history);

        let lastMode = 'undetermined';
        let lastCollectedData = {};

        for await (const event of gen) {
          if (event.type === 'token' && event.content) {
            await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: event.content }) });
          }

          if (event.type === 'state' && event.state) {
            lastMode = event.state.mode;
            lastCollectedData = event.state.collectedData;
          }

          if (event.type === 'lead' && event.leadData) {
            try {
              if (deps.pipedrive.isConfigured()) {
                const result = await deps.pipedrive.createLead(event.leadData);
                await stream.writeSSE({
                  data: JSON.stringify({ type: 'action', action: 'create_lead', data: result }),
                });
              }
              if (deps.email.isConfigured() && deps.notificationEmailTo) {
                await deps.email.sendLeadNotification(deps.notificationEmailTo, event.leadData);
              }
            } catch (err) {
              console.error('Lead creation error:', err);
            }
          }

          if (event.type === 'service' && event.serviceData) {
            try {
              if (deps.pipedrive.isConfigured()) {
                const result = await deps.pipedrive.createServiceActivity(event.serviceData);
                await stream.writeSSE({
                  data: JSON.stringify({ type: 'action', action: 'create_service', data: result }),
                });
              }
              if (deps.email.isConfigured() && deps.serviceEmailTo) {
                await deps.email.sendServiceNotification(deps.serviceEmailTo, event.serviceData);
              }
            } catch (err) {
              console.error('Service activity creation error:', err);
            }
          }
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', mode: lastMode, collectedData: lastCollectedData }),
        });
      } catch (err) {
        console.error('Chat stream error:', err);
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.' }),
        });
      }
    });
  });

  return app;
}
```

- [ ] **Step 2: Update index.ts to wire everything together**

Replace `backend/src/index.ts` with:
```typescript
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig } from './config/index.js';
import { createGeminiService } from './services/gemini.js';
import { createPipedriveService } from './services/pipedrive.js';
import { createEmailService } from './services/email.js';
import { createChatRoute } from './routes/chat.js';

const config = loadConfig();

const gemini = createGeminiService(config.geminiApiKey);
const pipedrive = createPipedriveService(config.pipedriveApiKey, config.pipedrivePipelineId, config.pipedriveStageId);
const email = createEmailService({
  host: config.smtpHost,
  port: config.smtpPort,
  user: config.smtpUser,
  pass: config.smtpPass,
});

const app = new Hono();

app.use('/api/*', cors({ origin: config.corsOrigin }));

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '1.0.0',
    pipedrive: pipedrive.isConfigured(),
    email: email.isConfigured(),
  });
});

const chatRoute = createChatRoute({
  gemini,
  pipedrive,
  email,
  notificationEmailTo: config.notificationEmailTo,
  serviceEmailTo: config.serviceEmailTo,
});

app.route('/', chatRoute);

const port = config.port;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sarah backend running on http://localhost:${info.port}`);
  console.log(`Pipedrive: ${pipedrive.isConfigured() ? 'configured' : 'not configured (placeholder)'}`);
  console.log(`Email: ${email.isConfigured() ? 'configured' : 'not configured'}`);
});

export default app;
```

- [ ] **Step 3: Verify compilation**

```bash
cd backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/chat.ts backend/src/index.ts
git commit -m "feat: add SSE chat route wiring Gemini, Pipedrive, and email"
```

---

## Task 9: Widget — Project Scaffolding + Theme

**Files:**
- Create: `widget/package.json`
- Create: `widget/tsconfig.json`
- Create: `widget/vite.config.ts`
- Create: `widget/src/styles/theme.ts`

- [ ] **Step 1: Initialize widget package**

```bash
cd /Users/camiloecheverri/Documents/AI/Lippebot
mkdir -p widget/src/styles widget/src/ui widget/src/api widget/src/storage
```

Write `widget/package.json`:
```json
{
  "name": "sarah-widget",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "jsdom": "^26.0.0"
  }
}
```

Write `widget/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Write `widget/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/sarah-widget.ts'),
      name: 'SarahWidget',
      fileName: 'sarah-widget',
      formats: ['iife'],
    },
    outDir: 'dist',
    minify: 'terser',
    rollupOptions: {
      output: {
        entryFileNames: 'sarah-widget.min.js',
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
```

- [ ] **Step 2: Write theme file**

Write `widget/src/styles/theme.ts`:
```typescript
export const COLORS = {
  lippeBlau: '#006AAB',
  lippeHellblau: '#B7CCE7',
  tiefblau: '#1C2740',
  warmOrange: '#E58434',
  softApricot: '#FFD9A0',
  lightCream: '#FFF2E2',
  white: '#FFFFFF',
} as const;

export const DIMENSIONS = {
  bubbleSize: 62,
  panelWidth: 360,
  panelHeight: 480,
  panelRadius: 16,
  bubbleRadius: '50%',
  shadow: '0 8px 32px rgba(0,0,0,0.15)',
  bubbleShadow: '0 4px 16px rgba(0,106,171,0.4)',
} as const;

export function injectStyles(): void {
  if (document.getElementById('sarah-widget-styles')) return;

  const style = document.createElement('style');
  style.id = 'sarah-widget-styles';
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&family=Instrument+Sans:wght@400;500;600&display=swap');

    .sarah-widget * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Instrument Sans', system-ui, sans-serif;
    }

    .sarah-widget h1, .sarah-widget h2, .sarah-widget h3 {
      font-family: 'Outfit', system-ui, sans-serif;
    }

    .sarah-bubble {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: ${DIMENSIONS.bubbleSize}px;
      height: ${DIMENSIONS.bubbleSize}px;
      background: ${COLORS.lippeBlau};
      border-radius: ${DIMENSIONS.bubbleRadius};
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: ${DIMENSIONS.bubbleShadow};
      z-index: 99998;
      border: none;
      transition: transform 0.2s ease;
    }

    .sarah-bubble:hover {
      transform: scale(1.08);
    }

    .sarah-bubble svg {
      width: 28px;
      height: 28px;
      fill: none;
      stroke: ${COLORS.white};
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .sarah-greeting {
      position: fixed;
      bottom: 90px;
      right: 20px;
      background: ${COLORS.white};
      padding: 10px 16px;
      border-radius: 12px 12px 0 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.12);
      font-size: 13px;
      color: ${COLORS.tiefblau};
      max-width: 220px;
      z-index: 99998;
      animation: sarahFadeIn 0.3s ease;
    }

    .sarah-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: ${DIMENSIONS.panelWidth}px;
      height: ${DIMENSIONS.panelHeight}px;
      background: ${COLORS.white};
      border-radius: ${DIMENSIONS.panelRadius}px;
      box-shadow: ${DIMENSIONS.shadow};
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 99999;
      animation: sarahSlideUp 0.3s ease;
    }

    .sarah-header {
      background: ${COLORS.lippeBlau};
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .sarah-avatar {
      width: 40px;
      height: 40px;
      background: ${COLORS.lippeHellblau};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 600;
      color: ${COLORS.tiefblau};
      flex-shrink: 0;
    }

    .sarah-header-text h3 {
      color: ${COLORS.white};
      font-size: 15px;
      font-weight: 600;
    }

    .sarah-header-text span {
      color: ${COLORS.lippeHellblau};
      font-size: 12px;
    }

    .sarah-close {
      margin-left: auto;
      color: ${COLORS.white};
      cursor: pointer;
      font-size: 20px;
      background: none;
      border: none;
      padding: 4px;
      line-height: 1;
    }

    .sarah-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      background: ${COLORS.lightCream};
    }

    .sarah-msg {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }

    .sarah-msg.user {
      justify-content: flex-end;
    }

    .sarah-msg-avatar {
      width: 28px;
      height: 28px;
      background: ${COLORS.lippeHellblau};
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: ${COLORS.tiefblau};
    }

    .sarah-msg-bubble {
      padding: 10px 14px;
      max-width: 85%;
      font-size: 13px;
      line-height: 1.5;
    }

    .sarah-msg.bot .sarah-msg-bubble {
      background: ${COLORS.white};
      color: ${COLORS.tiefblau};
      border-radius: 4px 14px 14px 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    .sarah-msg.user .sarah-msg-bubble {
      background: ${COLORS.lippeBlau};
      color: ${COLORS.white};
      border-radius: 14px 4px 14px 14px;
    }

    .sarah-quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
      padding-left: 36px;
    }

    .sarah-quick-btn {
      background: ${COLORS.white};
      border: 1.5px solid ${COLORS.lippeHellblau};
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: ${COLORS.lippeBlau};
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .sarah-quick-btn:hover {
      background: ${COLORS.lightCream};
    }

    .sarah-input-area {
      padding: 12px 16px;
      border-top: 1px solid #eee;
      display: flex;
      align-items: center;
      gap: 8px;
      background: ${COLORS.white};
      flex-shrink: 0;
    }

    .sarah-input {
      flex: 1;
      border: 1.5px solid ${COLORS.lippeHellblau};
      border-radius: 24px;
      padding: 10px 16px;
      font-size: 13px;
      outline: none;
      color: ${COLORS.tiefblau};
      font-family: 'Instrument Sans', system-ui, sans-serif;
    }

    .sarah-input:focus {
      border-color: ${COLORS.lippeBlau};
    }

    .sarah-send {
      width: 36px;
      height: 36px;
      background: ${COLORS.warmOrange};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border: none;
      flex-shrink: 0;
      transition: background 0.15s ease;
    }

    .sarah-send:hover {
      background: #d4762e;
    }

    .sarah-send:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .sarah-send svg {
      width: 16px;
      height: 16px;
      fill: ${COLORS.white};
    }

    .sarah-typing {
      display: flex;
      gap: 4px;
      padding: 10px 14px;
    }

    .sarah-typing span {
      width: 6px;
      height: 6px;
      background: ${COLORS.lippeHellblau};
      border-radius: 50%;
      animation: sarahBounce 1.4s infinite ease-in-out both;
    }

    .sarah-typing span:nth-child(1) { animation-delay: -0.32s; }
    .sarah-typing span:nth-child(2) { animation-delay: -0.16s; }

    @keyframes sarahBounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    @keyframes sarahFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes sarahSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  document.head.appendChild(style);
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd widget && npm install
```

- [ ] **Step 4: Verify compilation**

```bash
cd widget && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add widget/package.json widget/tsconfig.json widget/vite.config.ts widget/src/styles/theme.ts widget/package-lock.json
git commit -m "feat: scaffold widget with Vite, theme, and LippeLift brand styles"
```

---

## Task 10: Widget — SSE Client

**Files:**
- Create: `widget/src/api/client.ts`
- Create: `widget/tests/client.test.ts`

- [ ] **Step 1: Write test**

Create `widget/tests/client.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseSSELine } from '../src/api/client.js';

describe('parseSSELine', () => {
  it('parses a token event', () => {
    const result = parseSSELine('data: {"type":"token","content":"Hallo"}');
    expect(result).toEqual({ type: 'token', content: 'Hallo' });
  });

  it('parses a done event', () => {
    const result = parseSSELine('data: {"type":"done","mode":"berater","collectedData":{}}');
    expect(result).toEqual({ type: 'done', mode: 'berater', collectedData: {} });
  });

  it('returns null for empty lines', () => {
    expect(parseSSELine('')).toBeNull();
    expect(parseSSELine('\n')).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd widget && npx vitest run tests/client.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Write SSE client**

Write `widget/src/api/client.ts`:
```typescript
export interface SSEEvent {
  type: 'token' | 'done' | 'action' | 'error';
  content?: string;
  mode?: string;
  collectedData?: Record<string, unknown>;
  action?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data: ')) return null;
  try {
    return JSON.parse(trimmed.slice(6)) as SSEEvent;
  } catch {
    return null;
  }
}

export interface ChatClientOptions {
  apiUrl: string;
  onToken: (text: string) => void;
  onDone: (mode: string, collectedData: Record<string, unknown>) => void;
  onAction: (action: string, data: Record<string, unknown>) => void;
  onError: (error: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export async function sendMessage(
  options: ChatClientOptions,
  sessionId: string,
  message: string,
  history: ChatMessage[],
): Promise<void> {
  const response = await fetch(`${options.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, history }),
  });

  if (!response.ok || !response.body) {
    options.onError('Sarah ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const event = parseSSELine(line);
      if (!event) continue;

      switch (event.type) {
        case 'token':
          if (event.content) options.onToken(event.content);
          break;
        case 'done':
          options.onDone(event.mode || 'undetermined', event.collectedData || {});
          break;
        case 'action':
          if (event.action) options.onAction(event.action, event.data || {});
          break;
        case 'error':
          options.onError(event.error || 'Unbekannter Fehler');
          break;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd widget && npx vitest run tests/client.test.ts
# Expected: 4 tests pass
```

- [ ] **Step 5: Commit**

```bash
git add widget/src/api/client.ts widget/tests/client.test.ts
git commit -m "feat: add SSE client for streaming chat responses"
```

---

## Task 11: Widget — localStorage History

**Files:**
- Create: `widget/src/storage/history.ts`
- Create: `widget/tests/history.test.ts`

- [ ] **Step 1: Write test**

Create `widget/tests/history.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatHistory } from '../src/storage/history.js';

describe('ChatHistory', () => {
  let history: ChatHistory;

  beforeEach(() => {
    localStorage.clear();
    history = new ChatHistory();
  });

  it('starts with empty messages', () => {
    expect(history.getMessages()).toEqual([]);
  });

  it('adds and retrieves messages', () => {
    history.addMessage('user', 'Hallo');
    history.addMessage('assistant', 'Hallo! Ich bin Sarah.');
    const messages = history.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hallo');
    expect(messages[1].role).toBe('assistant');
  });

  it('persists to localStorage', () => {
    history.addMessage('user', 'Test');
    const newHistory = new ChatHistory();
    expect(newHistory.getMessages()).toHaveLength(1);
    expect(newHistory.getMessages()[0].content).toBe('Test');
  });

  it('clears messages', () => {
    history.addMessage('user', 'Test');
    history.clear();
    expect(history.getMessages()).toEqual([]);
  });

  it('expires after TTL', () => {
    history.addMessage('user', 'Old message');
    // Manually set old timestamp
    const data = JSON.parse(localStorage.getItem('sarah-chat-history')!);
    data.lastUpdated = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
    localStorage.setItem('sarah-chat-history', JSON.stringify(data));

    const newHistory = new ChatHistory();
    expect(newHistory.getMessages()).toEqual([]);
  });

  it('getSessionId returns consistent ID', () => {
    const id1 = history.getSessionId();
    const id2 = history.getSessionId();
    expect(id1).toBe(id2);
    expect(id1.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd widget && npx vitest run tests/history.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Write history module**

Write `widget/src/storage/history.ts`:
```typescript
interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface StoredData {
  sessionId: string;
  messages: StoredMessage[];
  lastUpdated: number;
}

const STORAGE_KEY = 'sarah-chat-history';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateId(): string {
  return `sarah-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ChatHistory {
  private data: StoredData;

  constructor() {
    this.data = this.load();
  }

  private load(): StoredData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { sessionId: generateId(), messages: [], lastUpdated: Date.now() };

      const parsed = JSON.parse(raw) as StoredData;
      if (Date.now() - parsed.lastUpdated > TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return { sessionId: generateId(), messages: [], lastUpdated: Date.now() };
      }
      return parsed;
    } catch {
      return { sessionId: generateId(), messages: [], lastUpdated: Date.now() };
    }
  }

  private save(): void {
    this.data.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  getMessages(): StoredMessage[] {
    return [...this.data.messages];
  }

  getSessionId(): string {
    return this.data.sessionId;
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.data.messages.push({ role, content, timestamp: Date.now() });
    this.save();
  }

  clear(): void {
    this.data = { sessionId: generateId(), messages: [], lastUpdated: Date.now() };
    localStorage.removeItem(STORAGE_KEY);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd widget && npx vitest run tests/history.test.ts
# Expected: 6 tests pass
```

- [ ] **Step 5: Commit**

```bash
git add widget/src/storage/history.ts widget/tests/history.test.ts
git commit -m "feat: add localStorage chat history with 7-day TTL"
```

---

## Task 12: Widget — Main Entry Point

**Files:**
- Create: `widget/src/sarah-widget.ts`

This is the largest file — it creates the bubble, panel, messages, and wires up the SSE client and history. Since the widget is a self-contained DOM-manipulating script (no framework), this file orchestrates all the UI pieces.

- [ ] **Step 1: Write the main widget entry point**

Write `widget/src/sarah-widget.ts`:
```typescript
import { injectStyles } from './styles/theme.js';
import { ChatHistory } from './storage/history.js';
import { sendMessage } from './api/client.js';

const CHAT_ICON = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
const CLOSE_ICON = '✕';
const SEND_ICON = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

const GREETING = 'Hallo! Ich bin Sarah. Kann ich Ihnen helfen?';
const OPENING_MESSAGE = 'Hallo! Ich bin Sarah, Ihre persönliche Beraterin bei LIPPE Lift. 😊 Wie kann ich Ihnen heute helfen?';

const QUICK_ACTIONS = [
  'Welcher Lift passt zu mir?',
  'Förderung & Zuschüsse',
  'Service & Wartung',
];

class SarahWidget {
  private apiUrl: string;
  private history: ChatHistory;
  private isOpen = false;
  private isStreaming = false;
  private container: HTMLDivElement;
  private bubble: HTMLButtonElement | null = null;
  private greetingEl: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private greetingDelay: number;

  constructor(apiUrl: string, options: { greeting?: string; delay?: number } = {}) {
    this.apiUrl = apiUrl;
    this.history = new ChatHistory();
    this.greetingDelay = options.delay || 3000;

    this.container = document.createElement('div');
    this.container.className = 'sarah-widget';
    document.body.appendChild(this.container);

    injectStyles();
    this.renderBubble();
    this.renderPanel();

    if (this.history.getMessages().length === 0) {
      setTimeout(() => this.showGreeting(), this.greetingDelay);
    }
  }

  private renderBubble(): void {
    this.bubble = document.createElement('button');
    this.bubble.className = 'sarah-bubble';
    this.bubble.innerHTML = CHAT_ICON;
    this.bubble.setAttribute('aria-label', 'Chat mit Sarah öffnen');
    this.bubble.addEventListener('click', () => this.toggle());
    this.container.appendChild(this.bubble);
  }

  private showGreeting(): void {
    if (this.isOpen || this.greetingEl) return;
    this.greetingEl = document.createElement('div');
    this.greetingEl.className = 'sarah-greeting';
    this.greetingEl.textContent = `👋 ${GREETING}`;
    this.greetingEl.addEventListener('click', () => this.toggle());
    this.container.appendChild(this.greetingEl);
  }

  private hideGreeting(): void {
    if (this.greetingEl) {
      this.greetingEl.remove();
      this.greetingEl = null;
    }
  }

  private renderPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'sarah-panel';
    this.panel.style.display = 'none';

    // Header
    const header = document.createElement('div');
    header.className = 'sarah-header';
    header.innerHTML = `
      <div class="sarah-avatar">S</div>
      <div class="sarah-header-text">
        <h3>Sarah</h3>
        <span>LIPPE Lift Assistentin</span>
      </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sarah-close';
    closeBtn.textContent = CLOSE_ICON;
    closeBtn.setAttribute('aria-label', 'Chat schließen');
    closeBtn.addEventListener('click', () => this.toggle());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    // Messages area
    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'sarah-messages';
    this.panel.appendChild(this.messagesEl);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'sarah-input-area';

    this.inputEl = document.createElement('input');
    this.inputEl.className = 'sarah-input';
    this.inputEl.placeholder = 'Nachricht eingeben...';
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'sarah-send';
    this.sendBtn.innerHTML = SEND_ICON;
    this.sendBtn.setAttribute('aria-label', 'Nachricht senden');
    this.sendBtn.addEventListener('click', () => this.handleSend());

    inputArea.appendChild(this.inputEl);
    inputArea.appendChild(this.sendBtn);
    this.panel.appendChild(inputArea);

    this.container.appendChild(this.panel);
  }

  private toggle(): void {
    this.isOpen = !this.isOpen;
    this.hideGreeting();

    if (this.isOpen) {
      this.panel!.style.display = 'flex';
      this.bubble!.style.display = 'none';
      this.inputEl!.focus();

      if (this.history.getMessages().length === 0) {
        this.addBotMessage(OPENING_MESSAGE);
        this.renderQuickActions();
      } else {
        this.restoreMessages();
      }
    } else {
      this.panel!.style.display = 'none';
      this.bubble!.style.display = 'flex';
    }
  }

  private restoreMessages(): void {
    this.messagesEl!.innerHTML = '';
    const messages = this.history.getMessages();
    for (const msg of messages) {
      this.appendMessageEl(msg.role === 'user' ? 'user' : 'bot', msg.content);
    }
    this.scrollToBottom();
  }

  private addBotMessage(text: string): void {
    this.history.addMessage('assistant', text);
    this.appendMessageEl('bot', text);
    this.scrollToBottom();
  }

  private addUserMessage(text: string): void {
    this.history.addMessage('user', text);
    this.appendMessageEl('user', text);
    this.scrollToBottom();
  }

  private appendMessageEl(type: 'bot' | 'user', text: string): void {
    const wrapper = document.createElement('div');
    wrapper.className = `sarah-msg ${type}`;

    if (type === 'bot') {
      wrapper.innerHTML = `
        <div class="sarah-msg-avatar">S</div>
        <div class="sarah-msg-bubble">${this.escapeHtml(text)}</div>
      `;
    } else {
      wrapper.innerHTML = `
        <div class="sarah-msg-bubble">${this.escapeHtml(text)}</div>
      `;
    }

    this.messagesEl!.appendChild(wrapper);
  }

  private createStreamingBubble(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'sarah-msg bot';

    const bubble = document.createElement('div');
    bubble.className = 'sarah-msg-bubble';

    wrapper.innerHTML = `<div class="sarah-msg-avatar">S</div>`;
    wrapper.appendChild(bubble);
    this.messagesEl!.appendChild(wrapper);

    return bubble;
  }

  private showTypingIndicator(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'sarah-msg bot';
    wrapper.innerHTML = `
      <div class="sarah-msg-avatar">S</div>
      <div class="sarah-typing"><span></span><span></span><span></span></div>
    `;
    this.messagesEl!.appendChild(wrapper);
    this.scrollToBottom();
    return wrapper;
  }

  private renderQuickActions(): void {
    const container = document.createElement('div');
    container.className = 'sarah-quick-actions';

    for (const action of QUICK_ACTIONS) {
      const btn = document.createElement('button');
      btn.className = 'sarah-quick-btn';
      btn.textContent = action;
      btn.addEventListener('click', () => {
        container.remove();
        this.sendUserMessage(action);
      });
      container.appendChild(btn);
    }

    this.messagesEl!.appendChild(container);
    this.scrollToBottom();
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl!.value.trim();
    if (!text || this.isStreaming) return;
    this.inputEl!.value = '';
    this.sendUserMessage(text);
  }

  private async sendUserMessage(text: string): Promise<void> {
    this.addUserMessage(text);
    this.isStreaming = true;
    this.sendBtn!.disabled = true;

    const typingEl = this.showTypingIndicator();
    let streamBubble: HTMLDivElement | null = null;
    let fullResponse = '';

    await sendMessage(
      {
        apiUrl: this.apiUrl,
        onToken: (token) => {
          if (typingEl.parentNode) typingEl.remove();
          if (!streamBubble) {
            streamBubble = this.createStreamingBubble();
          }
          fullResponse += token;
          streamBubble.textContent = fullResponse;
          this.scrollToBottom();
        },
        onDone: () => {
          if (typingEl.parentNode) typingEl.remove();
          if (fullResponse) {
            this.history.addMessage('assistant', fullResponse);
          }
        },
        onAction: () => {},
        onError: (error) => {
          if (typingEl.parentNode) typingEl.remove();
          this.addBotMessage(error);
        },
      },
      this.history.getSessionId(),
      text,
      this.history.getMessages().slice(0, -1), // exclude the message we just added
    );

    this.isStreaming = false;
    this.sendBtn!.disabled = false;
    this.inputEl!.focus();
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Auto-initialize from script tag
function init(): void {
  const script = document.currentScript || document.querySelector('script[data-api-url]');
  if (!script) return;

  const apiUrl = script.getAttribute('data-api-url');
  if (!apiUrl) {
    console.error('Sarah Widget: data-api-url attribute is required');
    return;
  }

  const delay = parseInt(script.getAttribute('data-delay') || '3000', 10);
  const greeting = script.getAttribute('data-greeting') || undefined;

  new SarahWidget(apiUrl, { greeting, delay });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { SarahWidget };
```

- [ ] **Step 2: Add index.html for local development**

Write `widget/index.html`:
```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sarah Widget — Dev</title>
</head>
<body>
  <h1 style="font-family:sans-serif;padding:40px;">LippeLift.de (Dev-Umgebung)</h1>
  <p style="font-family:sans-serif;padding:0 40px;">Das Sarah-Widget sollte unten rechts erscheinen.</p>
  <script type="module" src="/src/sarah-widget.ts" data-api-url="http://localhost:3000"></script>
</body>
</html>
```

- [ ] **Step 3: Build the widget**

```bash
cd widget && npx vite build
ls -la dist/
# Expected: sarah-widget.min.js exists
```

- [ ] **Step 4: Verify bundle size**

```bash
wc -c widget/dist/sarah-widget.min.js
# Expected: under ~100KB uncompressed (< 30KB gzipped)
gzip -c widget/dist/sarah-widget.min.js | wc -c
# Expected: under 30,000 bytes
```

- [ ] **Step 5: Commit**

```bash
git add widget/src/sarah-widget.ts widget/index.html
git commit -m "feat: add main widget entry with bubble, panel, streaming, and history"
```

---

## Task 13: Deployment Configuration

**Files:**
- Create: `deploy/Dockerfile`
- Create: `deploy/docker-compose.yml`
- Create: `deploy/nginx.conf`

- [ ] **Step 1: Write Dockerfile**

Write `deploy/Dockerfile`:
```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY Knowledge_Base_LippeLift.txt /app/../Knowledge_Base_LippeLift.txt
RUN npx tsc

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY Knowledge_Base_LippeLift.txt ../Knowledge_Base_LippeLift.txt

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Write docker-compose.yml**

Write `deploy/docker-compose.yml`:
```yaml
services:
  sarah-backend:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    restart: unless-stopped
    env_file:
      - ../backend/.env
    ports:
      - "3000:3000"
    networks:
      - sarah

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ../widget/dist:/usr/share/nginx/html/widget:ro
      # Mount your TLS certs here:
      # - /etc/letsencrypt/live/api.lippelift.de:/etc/nginx/certs:ro
    depends_on:
      - sarah-backend
    networks:
      - sarah

networks:
  sarah:
```

- [ ] **Step 3: Write nginx.conf**

Write `deploy/nginx.conf`:
```nginx
server {
    listen 80;
    server_name api.lippelift.de;

    # Redirect HTTP to HTTPS (uncomment when TLS is configured)
    # return 301 https://$host$request_uri;

    # Serve widget static files
    location /widget/ {
        alias /usr/share/nginx/html/widget/;
        expires 1h;
        add_header Cache-Control "public, immutable";
        add_header Access-Control-Allow-Origin "https://www.lippelift.de";
    }

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://sarah-backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # Health check
    location /health {
        proxy_pass http://sarah-backend:3000/api/health;
    }
}

# HTTPS server (uncomment when TLS is configured)
# server {
#     listen 443 ssl;
#     server_name api.lippelift.de;
#
#     ssl_certificate /etc/nginx/certs/fullchain.pem;
#     ssl_certificate_key /etc/nginx/certs/privkey.pem;
#
#     # Same location blocks as above
# }
```

- [ ] **Step 4: Commit**

```bash
git add deploy/Dockerfile deploy/docker-compose.yml deploy/nginx.conf
git commit -m "feat: add Docker and nginx deployment configuration"
```

---

## Task 14: Root-Level Setup + .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Write .gitignore**

Write `.gitignore`:
```
# Dependencies
node_modules/

# Build output
backend/dist/
widget/dist/

# Environment files
.env
backend/.env

# OS files
.DS_Store

# Brainstorm sessions
.superpowers/

# Editor
.vscode/
.idea/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

## Task 15: End-to-End Integration Test

**Files:**
- Create: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write integration test**

This test verifies the full chat route with mocked Gemini responses.

Create `backend/tests/integration.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createChatRoute } from '../src/routes/chat.js';
import type { GeminiService } from '../src/services/gemini.js';
import type { PipedriveService } from '../src/services/pipedrive.js';
import type { EmailService } from '../src/services/email.js';

function createMockGemini(): GeminiService {
  return {
    async *streamChat(sessionId: string, message: string) {
      yield { type: 'token' as const, content: 'Hallo! ' };
      yield { type: 'token' as const, content: 'Ich bin Sarah.' };
      yield {
        type: 'state' as const,
        state: { sessionId, mode: 'berater' as const, collectedData: {} },
      };
    },
  };
}

function createMockPipedrive(): PipedriveService {
  return {
    isConfigured: () => false,
    createLead: vi.fn(),
    createServiceActivity: vi.fn(),
  };
}

function createMockEmail(): EmailService {
  return {
    isConfigured: () => false,
    sendLeadNotification: vi.fn(),
    sendServiceNotification: vi.fn(),
  };
}

describe('POST /api/chat', () => {
  let app: Hono;

  beforeEach(() => {
    const chatRoute = createChatRoute({
      gemini: createMockGemini(),
      pipedrive: createMockPipedrive(),
      email: createMockEmail(),
      notificationEmailTo: '',
      serviceEmailTo: '',
    });
    app = new Hono();
    app.route('/', chatRoute);
  });

  it('returns 400 for invalid request', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('streams SSE response for valid request', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-123',
        message: 'Hallo',
        history: [],
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"token"');
    expect(text).toContain('Hallo!');
    expect(text).toContain('Ich bin Sarah.');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"mode":"berater"');
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd backend && GEMINI_API_KEY=fake npx vitest run tests/integration.test.ts
# Expected: 2 tests pass
```

- [ ] **Step 3: Run all backend tests**

```bash
cd backend && GEMINI_API_KEY=fake npx vitest run
# Expected: all tests pass
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/integration.test.ts
git commit -m "test: add integration test for chat route with mocked Gemini"
```

---

## Task 16: Live Smoke Test

This task requires a real Gemini API key.

- [ ] **Step 1: Create backend .env from example**

```bash
cd backend
cp .env.example .env
# Edit .env and add your real GEMINI_API_KEY
```

- [ ] **Step 2: Start backend**

```bash
cd backend && npx tsx src/index.ts &
sleep 2
curl http://localhost:3000/api/health
# Expected: {"status":"ok","version":"1.0.0","pipedrive":false,"email":false}
```

- [ ] **Step 3: Test chat endpoint with curl**

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","message":"Welcher Lift passt zu mir? Ich habe eine kurvige Innentreppe.","history":[]}'
# Expected: SSE stream with German response mentioning VARIO ONE or T80
# Should see data: {"type":"token","content":"..."} lines
# Should end with data: {"type":"done","mode":"berater",...}
```

- [ ] **Step 4: Test widget locally**

```bash
kill %1
# Start backend in background
cd backend && CORS_ORIGIN=http://localhost:5173 npx tsx src/index.ts &
# Start widget dev server
cd widget && npx vite --open
# Open browser → should see floating bubble → click → chat with Sarah
```

- [ ] **Step 5: Stop servers, commit any fixes**

```bash
kill %1 %2 2>/dev/null
```
