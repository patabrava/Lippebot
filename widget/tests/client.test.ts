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

  it('parses a line without a trailing newline', () => {
    const result = parseSSELine('data: {"type":"error","error":"Boom"}');
    expect(result).toEqual({ type: 'error', error: 'Boom' });
  });
});
