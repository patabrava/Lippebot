import { describe, it, expect } from 'vitest';
import { afterEach, vi } from 'vitest';
import { parseSSELine, sendMessage } from '../src/api/client.js';

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

  it('parses a line without a trailing newline', () => {
    const result = parseSSELine('data: {"type":"error","error":"Boom"}');
    expect(result).toEqual({ type: 'error', error: 'Boom' });
  });
});

describe('sendMessage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('includes the active requestId in the chat payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"done","mode":"berater","collectedData":{}}\n'));
    vi.stubGlobal('fetch', fetchMock);
    await sendMessage({
      apiUrl: 'https://api.example.test',
      onToken: vi.fn(), onDone: vi.fn(), onAction: vi.fn(), onError: vi.fn(),
    }, 'session-1', 'request-7', 'Hallo', []);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      sessionId: 'session-1',
      requestId: 'request-7',
      message: 'Hallo',
      history: [],
    });
  });
});
