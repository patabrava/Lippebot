import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig } from './config/index.js';
import { createGeminiService } from './services/gemini.js';
import { createPipedriveService } from './services/pipedrive.js';
import { createEmailService } from './services/email.js';
import { createConversationTracker } from './services/conversation-tracking.js';
import { createChatRoute } from './routes/chat.js';
import { createRequestJournal } from './request/request-journal.js';
import { createRequestOrchestrator } from './request/request-orchestrator.js';
import { resolveInternalEmailRecipients } from './email/recipients.js';

const config = loadConfig();

const gemini = createGeminiService({
  projectId: config.vertexAiProjectId,
  location: config.vertexAiLocation,
  enabled: config.vertexAiEnabled,
});
const pipedrive = createPipedriveService(config.pipedriveApiKey, config.pipedrivePipelineId, config.pipedriveStageId, {
  webBaseUrl: config.pipedriveWebBaseUrl,
  servicePipelineId: config.pipedriveServicePipelineId,
  serviceStageId: config.pipedriveServiceStageId,
  serviceOwnerId: config.pipedriveServiceOwnerId,
});
const email = createEmailService({
  host: config.smtpHost,
  port: config.smtpPort,
  user: config.smtpUser,
  pass: config.smtpPass,
  pipedriveWebBaseUrl: config.pipedriveWebBaseUrl,
});
const conversationTracker = createConversationTracker({
  enabled: config.conversationTrackingEnabled,
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
const requestJournal = createRequestJournal(conversationTracker);
const requestOrchestrator = createRequestOrchestrator({
  pipedrive,
  email,
  journal: requestJournal,
  opportunityRecipient: 'sales@lippelift.de',
  opportunityCopyRecipients: resolveInternalEmailRecipients(config.notificationEmailTo),
  serviceCopyRecipients: resolveInternalEmailRecipients(config.serviceEmailTo),
});

const app = new Hono();

app.use('/api/*', cors({ origin: config.corsOrigin }));

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '1.0.0',
    pipedrive: pipedrive.isConfigured(),
    email: email.isConfigured(),
    conversationTracking: conversationTracker.isEnabled(),
  });
});

const chatRoute = createChatRoute({
  gemini,
  pipedrive,
  email,
  conversationTracker,
  notificationEmailTo: config.notificationEmailTo,
  serviceEmailTo: config.serviceEmailTo,
  requestOrchestrator,
});

app.route('/', chatRoute);

const port = config.port;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sarah backend running on http://localhost:${info.port}`);
  console.log(`Pipedrive: ${pipedrive.isConfigured() ? 'configured' : 'not configured (placeholder)'}`);
  console.log(`Email: ${email.isConfigured() ? 'configured' : 'not configured'}`);
  console.log(`Conversation tracking: ${conversationTracker.isEnabled() ? 'enabled' : 'disabled'}`);
});

export default app;
