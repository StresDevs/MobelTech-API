// Local dev entrypoint. On Vercel, the serverless handler in `api/index.ts` is used instead.
import app from './app';
import { env } from './config/env';
import { ensureMaterialRequestsSchema } from './db/ensure-material-requests';

async function main() {
  await ensureMaterialRequestsSchema();

  app.listen(env.PORT, () => {
    console.log(`🚀 MobelTech API running on http://localhost:${env.PORT}`);
    console.log(`📊 Environment: ${env.NODE_ENV}`);
  });
}

void main().catch((error) => {
  console.error('❌ Failed to start API:', error);
  process.exit(1);
});

export default app;
