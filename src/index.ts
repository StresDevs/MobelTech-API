// Local dev entrypoint. On Vercel, the serverless handler in `api/index.ts` is used instead.
import app from './app';
import { env } from './config/env';
import { ensureUsersSchema } from './db/ensure-users';
import { ensureContractorFinanceSchema } from './db/ensure-contractor-finance';
import { ensureMaterialRequestsSchema } from './db/ensure-material-requests';
import { ensureNotificationsSchema } from './db/ensure-notifications';
import { ensurePrequotationUidSchema } from './db/ensure-prequotation-uid';
import { ensureProductionItemPhasesSchema } from './db/ensure-production-item-phases';

async function runStartupTasks() {
  const tasks = [
    ['users', ensureUsersSchema],
    ['contractor-finance', ensureContractorFinanceSchema],
    ['material-requests', ensureMaterialRequestsSchema],
    ['notifications', ensureNotificationsSchema],
    ['prequotation-uid', ensurePrequotationUidSchema],
    ['production-item-phases', ensureProductionItemPhasesSchema],
  ] as const;

  const results = await Promise.allSettled(tasks.map(([, task]) => task()));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const [taskName] = tasks[index];
      console.error(`❌ Startup task failed: ${taskName}`, result.reason);
    }
  });
}

async function main() {
  app.listen(env.PORT, () => {
    console.log(`🚀 MobelTech API running on http://localhost:${env.PORT}`);
    console.log(`📊 Environment: ${env.NODE_ENV}`);
  });

  void runStartupTasks();
}

void main().catch((error) => {
  console.error('❌ Failed to start API:', error);
  process.exit(1);
});

export default app;
