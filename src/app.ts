import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import routes from './routes';
import { errorHandler } from './middleware/error-handler';

const app = express();

// CORS_ORIGIN supports comma-separated list (e.g. "http://localhost:3000,https://app.example.com")
const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin (curl, server-to-server, health checks) and exact matches
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '8mb' }));

// Health check
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'mobeltech-api',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api', routes);

// Error handler (must be last)
app.use(errorHandler);

export default app;
