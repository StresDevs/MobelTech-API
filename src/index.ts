// Local dev entrypoint. On Vercel, the serverless handler in `api/index.ts` is used instead.
import app from './app';
import { env } from './config/env';

app.listen(env.PORT, () => {
  console.log(`🚀 MobelTech API running on http://localhost:${env.PORT}`);
  console.log(`📊 Environment: ${env.NODE_ENV}`);
});

export default app;
