import { z } from 'zod';
import {
  DEFAULT_BYPASS_EMAIL_RECIPIENTS,
  DEFAULT_INTERNAL_EMAIL_RECIPIENTS,
  resolveBypassEmailRecipients,
} from '../email/recipients.js';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

const configSchema = z.object({
  vertexAiEnabled: z.boolean().default(true),
  vertexAiProjectId: z.string().min(1),
  vertexAiLocation: z.string().min(1).default('us-central1'),
  pipedriveApiKey: z.string().default(''),
  pipedrivePipelineId: z.coerce.number().default(1),
  pipedriveStageId: z.coerce.number().default(1),
  pipedriveServicePipelineId: z.coerce.number().default(1),
  pipedriveServiceStageId: z.coerce.number().default(2),
  pipedriveServiceOwnerId: z.coerce.number().default(24093328),
  pipedriveWebBaseUrl: z.string().default('https://lippelift.pipedrive.com'),
  pipedriveBypassEnabled: z.boolean().default(false),
  pipedriveBypassEmailTo: z.string().default(DEFAULT_BYPASS_EMAIL_RECIPIENTS),
  smtpHost: z.string().default(''),
  smtpPort: z.coerce.number().default(587),
  smtpUser: z.string().default(''),
  smtpPass: z.string().default(''),
  notificationEmailTo: z.string().default(DEFAULT_INTERNAL_EMAIL_RECIPIENTS),
  serviceEmailTo: z.string().default(DEFAULT_INTERNAL_EMAIL_RECIPIENTS),
  supabaseUrl: z.string().default(''),
  supabaseServiceRoleKey: z.string().default(''),
  conversationTrackingEnabled: z.boolean().default(false),
  port: z.coerce.number().default(3000),
  corsOrigin: z.string().default('http://localhost:5173'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((config, context) => {
  if (!config.pipedriveBypassEnabled) return;

  const recipients = resolveBypassEmailRecipients(config.pipedriveBypassEmailTo);
  if (recipients.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pipedriveBypassEmailTo'],
      message: 'At least one bypass email recipient is required when Pipedrive bypass is enabled',
    });
    return;
  }

  for (const recipient of recipients) {
    if (!z.string().email().safeParse(recipient).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pipedriveBypassEmailTo'],
        message: `Invalid bypass email recipient: ${recipient}`,
      });
    }
  }
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    vertexAiEnabled: parseBoolean(process.env.VERTEX_AI_ENABLED, true),
    vertexAiProjectId: process.env.VERTEX_AI_PROJECT_ID || process.env.GCP_PROJECT_ID,
    vertexAiLocation: process.env.VERTEX_AI_LOCATION || process.env.GCP_LOCATION,
    pipedriveApiKey: process.env.PIPEDRIVE_API_KEY,
    pipedrivePipelineId: process.env.PIPEDRIVE_PIPELINE_ID,
    pipedriveStageId: process.env.PIPEDRIVE_STAGE_ID,
    pipedriveServicePipelineId: process.env.PIPEDRIVE_SERVICE_PIPELINE_ID,
    pipedriveServiceStageId: process.env.PIPEDRIVE_SERVICE_STAGE_ID,
    pipedriveServiceOwnerId: process.env.PIPEDRIVE_SERVICE_OWNER_ID,
    pipedriveWebBaseUrl: process.env.PIPEDRIVE_WEB_BASE_URL,
    pipedriveBypassEnabled: parseBoolean(process.env.PIPEDRIVE_BYPASS_ENABLED, false),
    pipedriveBypassEmailTo: process.env.PIPEDRIVE_BYPASS_EMAIL_TO,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    notificationEmailTo: process.env.NOTIFICATION_EMAIL_TO,
    serviceEmailTo: process.env.SERVICE_EMAIL_TO,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    conversationTrackingEnabled: parseBoolean(process.env.CONVERSATION_TRACKING_ENABLED, false),
    port: process.env.PORT,
    corsOrigin: process.env.CORS_ORIGIN,
    nodeEnv: process.env.NODE_ENV,
  });
}
