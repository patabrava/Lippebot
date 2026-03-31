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
