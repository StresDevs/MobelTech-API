import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

export function ensureNotificationsSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS notifications (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message text NOT NULL,
          related_job_id uuid,
          read boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
        ON notifications(recipient_user_id, created_at DESC)
      `;

      console.log('✅ Notifications schema is ready.');
    })();
  }

  return ensurePromise;
}
