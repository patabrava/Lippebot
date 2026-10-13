import { describe, expect, it, vi } from 'vitest';
import { createChatRoute } from '../src/routes/chat.js';
import type { GeminiService } from '../src/services/gemini.js';
import type { PipedriveService } from '../src/services/pipedrive.js';
import type { EmailService } from '../src/services/email.js';
import type { ChatMessage, Mode, SSEEvent } from '../src/types/index.js';
import { stl300Inquiry, stl300Clarification } from './fixtures/stl300-inquiry.js';

function events(text: string): SSEEvent[] {
  return text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
}

describe('multi-turn intake stress regressions', () => {
  it.each(['installed', 'ordered'] as const)('completes %s-lift service without model field reports', async (situation) => {
    const execute = vi.fn(async (_input: unknown) => ({ requestId: 'service-stress', kind: 'service' as const, completed: true as const, recipient: 'test@example.de' }));
    const app = createChatRoute({
      gemini: { async *streamChat(sessionId) {
        yield { type: 'token', content: 'Beschreibe mir bitte kurz dein Anliegen.' };
        yield { type: 'state', state: { sessionId, mode: 'service', collectedData: {} } };
      } } as GeminiService,
      pipedrive: {} as PipedriveService, email: {} as EmailService,
      requestOrchestrator: { execute }, notificationEmailTo: '', serviceEmailTo: '',
    });
    const inputs = situation === 'installed'
      ? ['Mein Sitzlift ist kaputt.', 'Der Lift ist schon eingebaut', 'Alex Beispiel', 'test@example.de', 'nur per email bitte', 'Nein', 'LIPPE Lift', 'Ich habe keine Fabriknummer', 'Ja']
      : ['Der Lift ist bereits bestellt. Ich habe eine Frage zum Vertrag.', 'Alex Beispiel', 'test@example.de', 'nur per email bitte', 'Nein', 'Ja'];
    const history: ChatMessage[] = [];
    for (const message of inputs) {
      const result = events(await (await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: situation, requestId: 'service-stress', message, history }) })).text());
      expect(result.some((event) => event.type === 'error')).toBe(false);
      const response = result.filter((event) => event.type === 'token').map((event) => event.content).join('');
      expect(response).not.toContain('Beschreibe mir');
      if (situation === 'ordered') expect(response).not.toMatch(/Fabriknummer|Hersteller|vollständigen Adresse/);
      history.push({ role: 'user', content: message, timestamp: 1 }, { role: 'assistant', content: response, timestamp: 2 });
    }
    expect(execute).toHaveBeenCalledOnce();
    const input = execute.mock.calls[0][0] as { supportData: { requestSituation: string; issueDescription: string } };
    expect(input.supportData.requestSituation).toBe(situation === 'installed' ? 'installed_lift' : 'ordered_not_installed');
    expect(input.supportData.issueDescription).toBe(inputs[0]);
  });

  it.each(Array.from({ length: 12 }, (_, index) => index))('completes STL300 intake despite partial and contradictory model responses (variant %i)', async (variant) => {
    const execute = vi.fn(async (_input: unknown) => ({ requestId: 'stress-request', kind: 'opportunity' as const, completed: true as const, recipient: 'test@example.de' }));
    const streamChat = vi.fn(async function* (sessionId: string, message: string) {
      const fields: Record<string, Record<string, unknown>> = {
        'Tina Beispiel': { firstName: 'Tina', lastName: 'Beispiel' },
        'draußen': { stairLocation: 'aussen' },
        'rollstuhlgeeignet': { liftType: 'rollstuhlgeeignet' },
        'Mehrfamilienhaus': { buildingType: 'mehrfamilienhaus' },
        'geschäftlich': { customerSegment: 'firma' },
        'Musterstraße 4, 80331 München': { street: 'Musterstraße 4', postalCode: '80331', city: 'München' },
      };
      // Deliberately reproduce the missing description and erroneous mode
      // reports. Only the answer to this turn is reported; no cumulative state.
      yield { type: 'token' as const, content: variant % 3 === 0
        ? 'Beschreibe mir bitte kurz, worum es bei deiner Anfrage geht.'
        : variant % 3 === 1 ? 'Wie lautet deine E-Mail-Adresse?'
          : 'Ich meinte damit, ob du schon Kontakt mit uns hattest. Beschreibe mir bitte kurz, worum es geht.' };
      yield { type: 'state' as const, state: {
        sessionId,
        mode: (variant % 2 === 0 ? 'service' : 'anfrage') as Mode,
        collectedData: variant % 4 === 0 ? {} : { ...fields[message] },
      } };
    });
    const app = createChatRoute({
      gemini: { streamChat } as GeminiService,
      pipedrive: {} as PipedriveService,
      email: {} as EmailService,
      requestOrchestrator: { execute },
      notificationEmailTo: '', serviceEmailTo: '',
    });
    const history: ChatMessage[] = [];
    const inputs = [stl300Inquiry, 'einen neuen lift', 'Tina Beispiel', 'test@example.de', 'nur per email bitte', 'Nein', 'draußen', 'rollstuhlgeeignet', 'Mehrfamilienhaus', 'geschäftlich', 'Musterstraße 4, 80331 München', 'Ja'];
    for (const [index, message] of inputs.entries()) {
      const result = events(await (await app.request('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: `stress-${variant}`, requestId: 'stress-request', message, history }),
      })).text());
      expect(result.find((event) => event.type === 'error')).toBeUndefined();
      const response = result.filter((event) => event.type === 'token').map((event) => event.content).join('');
      expect(response).not.toMatch(/Beschreibe mir|Ich knüpfe|Ich meinte/);
      expect(result.find((event) => event.type === 'done')?.mode).toBe('anfrage');
      if (index === 4) expect(response).toContain('Hattest du wegen dieses Anliegens');
      if (index > 4) expect(response).not.toContain('Wie lautet deine Telefonnummer?');
      if (index === 10) {
        expect(response).toContain('Sind alle Angaben korrekt?');
        expect(execute).not.toHaveBeenCalled();
      }
      history.push({ role: 'user', content: message, timestamp: index * 2 }, { role: 'assistant', content: response, timestamp: index * 2 + 1 });
    }
    expect(execute).toHaveBeenCalledOnce();
    const lead = execute.mock.calls[0][0] as unknown as { leadData: { message: string } };
    expect(lead.leadData.message).toContain('1.820 × 1.450');
    expect(lead.leadData.message).toContain('DWG');
  });

  it('recovers an already stuck customer history without asking them to describe it again', async () => {
    const app = createChatRoute({
      gemini: { async *streamChat(sessionId) {
        yield { type: 'state', state: { sessionId, mode: 'anfrage', collectedData: { firstName: 'Tina', lastName: 'Beispiel' } } };
        yield { type: 'token', content: 'Beschreibe mir bitte kurz, worum es bei deiner Anfrage geht.' };
      } } as GeminiService,
      pipedrive: {} as PipedriveService, email: {} as EmailService,
      requestOrchestrator: { execute: vi.fn() }, notificationEmailTo: '', serviceEmailTo: '',
    });
    const history: ChatMessage[] = [stl300Inquiry, 'einen neuen lift', 'test@example.de', 'nur per email bitte'].map((content) => ({ role: 'user', content, timestamp: 1 }));
    history.push({ role: 'assistant', content: 'Beschreibe mir bitte kurz, worum es bei deiner Anfrage geht.', timestamp: 2 });
    const response = events(await (await app.request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'resume-stuck', requestId: 'resume-stuck-request', message: stl300Clarification, history }) })).text());
    expect(response.filter((event) => event.type === 'token').map((event) => event.content).join('')).toContain('Hattest du wegen dieses Anliegens');
    expect(response.find((event) => event.type === 'done')?.collectedData?.message).toContain('1.820 × 1.450');
  });
});
