import { describe, it, expect } from 'vitest';
import { createGeminiService } from '../src/services/gemini.js';

describe('createGeminiService', () => {
  it('creates a service with streamChat method', () => {
    const service = createGeminiService('fake-key');
    expect(service).toHaveProperty('streamChat');
    expect(typeof service.streamChat).toBe('function');
  });
});
