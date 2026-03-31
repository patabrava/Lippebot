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
