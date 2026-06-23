import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

export function ensureFurnitureFilesSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'furniture_file_log_action') THEN
            CREATE TYPE furniture_file_log_action AS ENUM ('file_uploaded', 'file_downloaded');
          END IF;
        END $$;
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS furniture_files (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          quotation_id uuid REFERENCES quotations(id) ON DELETE CASCADE,
          project_environment_id uuid REFERENCES project_environments(id) ON DELETE CASCADE,
          client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
          assigned_contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
          version integer NOT NULL DEFAULT 1,
          file_name varchar(255) NOT NULL,
          file_size varchar(80),
          mime_type varchar(160),
          file_data text NOT NULL,
          uploaded_by varchar(160) NOT NULL,
          notes text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS furniture_file_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          furniture_file_id uuid REFERENCES furniture_files(id) ON DELETE CASCADE,
          action furniture_file_log_action NOT NULL,
          performed_by varchar(160) NOT NULL,
          description text NOT NULL,
          performed_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS furniture_files_quotation_idx ON furniture_files(quotation_id)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_files_environment_idx ON furniture_files(project_environment_id)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_files_contractor_idx ON furniture_files(assigned_contractor_id)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_file_logs_file_idx ON furniture_file_logs(furniture_file_id)`;

      console.log('Furniture files schema is ready.');
    })();
  }

  return ensurePromise;
}
