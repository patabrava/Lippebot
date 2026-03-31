import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use('/api/*', cors({ origin: corsOrigin }));

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '1.0.0' });
});

const port = parseInt(process.env.PORT || '3000', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Sarah backend running on http://localhost:${info.port}`);
});

export default app;
