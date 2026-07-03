import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

export function ensureQuotationWorkflowSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        ALTER TABLE quotations
        ADD COLUMN IF NOT EXISTS uid varchar(24)
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS quotations_uid_unique_idx
        ON quotations(uid)
        WHERE uid IS NOT NULL
      `;

      await sql`
        UPDATE quotations q
        SET uid = p.uid
        FROM prequotations p
        WHERE p.converted_to_quotation_id = q.id
          AND q.uid IS NULL
          AND p.uid IS NOT NULL
      `;

      await sql`
        ALTER TABLE project_environments
        ADD COLUMN IF NOT EXISTS sketchup_file_name varchar(255),
        ADD COLUMN IF NOT EXISTS sketchup_file_url text,
        ADD COLUMN IF NOT EXISTS sketchup_file_size varchar(80),
        ADD COLUMN IF NOT EXISTS client_price numeric(12, 2) NOT NULL DEFAULT 0
      `;

      await sql`
        UPDATE project_environments
        SET client_price = COALESCE(client_price, price, 0)
        WHERE client_price IS NULL OR client_price = 0
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS quotation_audit_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
          field varchar(120) NOT NULL,
          previous_value text NOT NULL,
          next_value text NOT NULL,
          comment text,
          changed_by varchar(255) NOT NULL,
          changed_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        ALTER TABLE quotation_audit_logs
        ADD COLUMN IF NOT EXISTS comment text
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS quotation_audit_logs_quotation_idx
        ON quotation_audit_logs(quotation_id, changed_at DESC)
      `;

      console.log('Quotation workflow schema is ready.');
    })();
  }

  return ensurePromise;
}
