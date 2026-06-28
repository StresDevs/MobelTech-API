import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

async function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  const escapedDefinition = definition.replace(/'/g, "''");

  await sql.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${tableName}'
          AND column_name = '${columnName}'
      ) THEN
        EXECUTE 'ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${escapedDefinition}';
      END IF;
    END $$;
  `);
}

export function ensureFurnitureFilesSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

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
          file_kind varchar(40) NOT NULL DEFAULT 'initial',
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

      await addColumnIfMissing('furniture_files', 'quotation_id', 'uuid REFERENCES quotations(id) ON DELETE CASCADE');
      await addColumnIfMissing('furniture_files', 'project_environment_id', 'uuid REFERENCES project_environments(id) ON DELETE CASCADE');
      await addColumnIfMissing('furniture_files', 'client_id', 'uuid REFERENCES clients(id) ON DELETE SET NULL');
      await addColumnIfMissing('furniture_files', 'assigned_contractor_id', 'uuid REFERENCES contractors(id) ON DELETE SET NULL');
      await addColumnIfMissing('furniture_files', 'file_kind', "varchar(40) NOT NULL DEFAULT 'initial'");
      await addColumnIfMissing('furniture_files', 'version', 'integer NOT NULL DEFAULT 1');
      await addColumnIfMissing('furniture_files', 'file_name', 'varchar(255)');
      await addColumnIfMissing('furniture_files', 'file_size', 'varchar(80)');
      await addColumnIfMissing('furniture_files', 'mime_type', 'varchar(160)');
      await addColumnIfMissing('furniture_files', 'file_data', 'text');
      await addColumnIfMissing('furniture_files', 'uploaded_by', 'varchar(160)');
      await addColumnIfMissing('furniture_files', 'notes', 'text');
      await addColumnIfMissing('furniture_files', 'created_at', 'timestamptz NOT NULL DEFAULT now()');
      await addColumnIfMissing('furniture_files', 'updated_at', 'timestamptz NOT NULL DEFAULT now()');

      await sql`
        UPDATE furniture_files
        SET
          file_name = COALESCE(file_name, 'archivo-sketchup.skp'),
          file_kind = COALESCE(file_kind, 'initial'),
          file_data = COALESCE(file_data, ''),
          uploaded_by = COALESCE(uploaded_by, 'Sistema')
        WHERE file_name IS NULL OR file_kind IS NULL OR file_data IS NULL OR uploaded_by IS NULL
      `;

      await sql`
        ALTER TABLE furniture_files
          ALTER COLUMN file_name SET NOT NULL,
          ALTER COLUMN file_kind SET NOT NULL,
          ALTER COLUMN file_data SET NOT NULL,
          ALTER COLUMN uploaded_by SET NOT NULL
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

      await addColumnIfMissing('furniture_file_logs', 'furniture_file_id', 'uuid REFERENCES furniture_files(id) ON DELETE CASCADE');
      await addColumnIfMissing('furniture_file_logs', 'action', "furniture_file_log_action NOT NULL DEFAULT 'file_uploaded'");
      await addColumnIfMissing('furniture_file_logs', 'performed_by', 'varchar(160)');
      await addColumnIfMissing('furniture_file_logs', 'description', 'text');
      await addColumnIfMissing('furniture_file_logs', 'performed_at', 'timestamptz NOT NULL DEFAULT now()');

      await sql`
        UPDATE furniture_file_logs
        SET
          action = COALESCE(action, 'file_uploaded'::furniture_file_log_action),
          performed_by = COALESCE(performed_by, 'Sistema'),
          description = COALESCE(description, 'Accion registrada')
        WHERE action IS NULL OR performed_by IS NULL OR description IS NULL
      `;

      await sql`
        ALTER TABLE furniture_file_logs
          ALTER COLUMN action SET NOT NULL,
          ALTER COLUMN performed_by SET NOT NULL,
          ALTER COLUMN description SET NOT NULL
      `;

      await sql`CREATE INDEX IF NOT EXISTS furniture_files_quotation_idx ON furniture_files(quotation_id)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_files_environment_idx ON furniture_files(project_environment_id)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_files_contractor_idx ON furniture_files(assigned_contractor_id)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_files_kind_idx ON furniture_files(file_kind)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_files_created_at_idx ON furniture_files(created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS furniture_file_logs_file_idx ON furniture_file_logs(furniture_file_id)`;

      console.log('Furniture files schema is ready.');
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  return ensurePromise;
}
