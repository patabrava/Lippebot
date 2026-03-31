import { z } from 'zod';

const configSchema = z.object({
  geminiApiKey: z.string().min(1),
  pipedriveApiKey: z.string().default(''),
  pipedrivePipelineId: z.coerce.number().default(1),
  pipedriveStageId: z.coerce.number().default(1),
  smtpHost: z.string().default(''),
  smtpPort: z.coerce.number().default(587),
  smtpUser: z.string().default(''),
  smtpPass: z.string().default(''),
  notificationEmailTo: z.string().default(''),
  serviceEmailTo: z.string().default(''),
  port: z.coerce.number().default(3000),
  corsOrigin: z.string().default('http://localhost:5173'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    geminiApiKey: process.env.GEMINI_API_KEY,
    pipedriveApiKey: process.env.PIPEDRIVE_API_KEY,
    pipedrivePipelineId: process.env.PIPEDRIVE_PIPELINE_ID,
    pipedriveStageId: process.env.PIPEDRIVE_STAGE_ID,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: process.env.SMTP_PORT,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    notificationEmailTo: process.env.NOTIFICATION_EMAIL_TO,
    serviceEmailTo: process.env.SERVICE_EMAIL_TO,
    port: process.env.PORT,
    corsOrigin: process.env.CORS_ORIGIN,
    nodeEnv: process.env.NODE_ENV,
  });
}
