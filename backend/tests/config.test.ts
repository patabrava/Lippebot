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

  it('throws if VERTEX_AI_PROJECT_ID is missing', () => {
    delete process.env.VERTEX_AI_PROJECT_ID;
    process.env.VERTEX_AI_LOCATION = 'us-central1';
    process.env.VERTEX_AI_ENABLED = 'true';
    expect(() => loadConfig()).toThrow();
  });

  it('loads config with Vertex AI settings', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    process.env.VERTEX_AI_LOCATION = 'us-central1';
    process.env.VERTEX_AI_ENABLED = 'True';
    const config = loadConfig();
    expect(config.vertexAiProjectId).toBe('test-project');
    expect(config.vertexAiLocation).toBe('us-central1');
    expect(config.vertexAiEnabled).toBe(true);
    expect(config.port).toBe(3000);
    expect(config.corsOrigin).toBe('http://localhost:5173');
    expect(config.pipedriveApiKey).toBe('');
  });
});
