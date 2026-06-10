// Vercel serverless entrypoint.
// Vercel auto-detects files under /api as Node.js Functions.
// We delegate every request to the Express app exported from src/app.ts.
import app from '../src/app';

export default app;
