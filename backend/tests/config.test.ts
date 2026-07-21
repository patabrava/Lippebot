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
    delete process.env.PIPEDRIVE_WEB_BASE_URL;
    const config = loadConfig();
    expect(config.vertexAiProjectId).toBe('test-project');
    expect(config.vertexAiLocation).toBe('us-central1');
    expect(config.vertexAiEnabled).toBe(true);
    expect(config.port).toBe(3000);
    expect(config.corsOrigin).toBe('http://localhost:5173');
    expect(config.pipedriveApiKey).toBe('');
    expect(config.pipedriveWebBaseUrl).toBe('https://lippelift.pipedrive.com');
    expect(config.pipedriveServicePipelineId).toBe(1);
    expect(config.pipedriveServiceStageId).toBe(2);
    expect(config.pipedriveServiceOwnerId).toBe(24093328);
  });

  it('loads a configured Pipedrive web base URL', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    process.env.PIPEDRIVE_WEB_BASE_URL = 'https://example.pipedrive.com';

    expect(loadConfig().pipedriveWebBaseUrl).toBe('https://example.pipedrive.com');
  });

  it('loads configured Serviceanfrage destination IDs', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    process.env.PIPEDRIVE_SERVICE_PIPELINE_ID = '11';
    process.env.PIPEDRIVE_SERVICE_STAGE_ID = '22';
    process.env.PIPEDRIVE_SERVICE_OWNER_ID = '33';

    const config = loadConfig();
    expect(config.pipedriveServicePipelineId).toBe(11);
    expect(config.pipedriveServiceStageId).toBe(22);
    expect(config.pipedriveServiceOwnerId).toBe(33);
  });

  it('defaults conversation tracking to disabled', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CONVERSATION_TRACKING_ENABLED;

    const config = loadConfig();

    expect(config.supabaseUrl).toBe('');
    expect(config.supabaseServiceRoleKey).toBe('');
    expect(config.conversationTrackingEnabled).toBe(false);
  });

  it('loads Supabase conversation tracking settings', () => {
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    process.env.SUPABASE_URL = 'https://qnvgiihzbihkedakggth.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.CONVERSATION_TRACKING_ENABLED = 'true';

    const config = loadConfig();

    expect(config.supabaseUrl).toBe('https://qnvgiihzbihkedakggth.supabase.co');
    expect(config.supabaseServiceRoleKey).toBe('service-role-key');
    expect(config.conversationTrackingEnabled).toBe(true);
  });
});
