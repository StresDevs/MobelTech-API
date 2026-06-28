BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'furniture_file_log_action') THEN
    CREATE TYPE furniture_file_log_action AS ENUM ('file_uploaded', 'file_downloaded');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS furniture_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid REFERENCES quotations(id) ON DELETE CASCADE,
  project_environment_id uuid REFERENCES project_environments(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  assigned_contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
  file_kind varchar(40) NOT NULL DEFAULT 'initial',
  version integer NOT NULL DEFAULT 1,
  file_name varchar(255) NOT NULL DEFAULT 'archivo-sketchup.skp',
  file_size varchar(80),
  mime_type varchar(160),
  file_data text NOT NULL DEFAULT '',
  uploaded_by varchar(160) NOT NULL DEFAULT 'Sistema',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

UPDATE furniture_files
SET
  file_name = COALESCE(file_name, 'archivo-sketchup.skp'),
  file_kind = COALESCE(file_kind, 'initial'),
  file_data = COALESCE(file_data, ''),
  uploaded_by = COALESCE(uploaded_by, 'Sistema')
WHERE file_name IS NULL OR file_kind IS NULL OR file_data IS NULL OR uploaded_by IS NULL;

ALTER TABLE furniture_files
  ALTER COLUMN file_name SET NOT NULL,
  ALTER COLUMN file_kind SET NOT NULL,
  ALTER COLUMN file_data SET NOT NULL,
  ALTER COLUMN uploaded_by SET NOT NULL;

CREATE TABLE IF NOT EXISTS furniture_file_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  furniture_file_id uuid REFERENCES furniture_files(id) ON DELETE CASCADE,
  action furniture_file_log_action NOT NULL,
  performed_by varchar(160) NOT NULL,
  description text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'quotation_id'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN quotation_id uuid REFERENCES quotations(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'project_environment_id'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN project_environment_id uuid REFERENCES project_environments(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'assigned_contractor_id'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN assigned_contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'file_kind'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN file_kind varchar(40) NOT NULL DEFAULT 'initial';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'version'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN version integer NOT NULL DEFAULT 1;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'file_name'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN file_name varchar(255);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'file_size'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN file_size varchar(80);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'mime_type'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN mime_type varchar(160);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'file_data'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN file_data text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'uploaded_by'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN uploaded_by varchar(160);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'notes'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN notes text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_files' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE furniture_files ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_file_logs' AND column_name = 'furniture_file_id'
  ) THEN
    ALTER TABLE furniture_file_logs ADD COLUMN furniture_file_id uuid REFERENCES furniture_files(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_file_logs' AND column_name = 'action'
  ) THEN
    ALTER TABLE furniture_file_logs ADD COLUMN action furniture_file_log_action NOT NULL DEFAULT 'file_uploaded';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_file_logs' AND column_name = 'performed_by'
  ) THEN
    ALTER TABLE furniture_file_logs ADD COLUMN performed_by varchar(160);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_file_logs' AND column_name = 'description'
  ) THEN
    ALTER TABLE furniture_file_logs ADD COLUMN description text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'furniture_file_logs' AND column_name = 'performed_at'
  ) THEN
    ALTER TABLE furniture_file_logs ADD COLUMN performed_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

UPDATE furniture_file_logs
SET
  action = COALESCE(action, 'file_uploaded'::furniture_file_log_action),
  performed_by = COALESCE(performed_by, 'Sistema'),
  description = COALESCE(description, 'Accion registrada')
WHERE action IS NULL OR performed_by IS NULL OR description IS NULL;

ALTER TABLE furniture_file_logs
  ALTER COLUMN action SET NOT NULL,
  ALTER COLUMN performed_by SET NOT NULL,
  ALTER COLUMN description SET NOT NULL;

CREATE INDEX IF NOT EXISTS furniture_files_quotation_idx ON furniture_files(quotation_id);
CREATE INDEX IF NOT EXISTS furniture_files_environment_idx ON furniture_files(project_environment_id);
CREATE INDEX IF NOT EXISTS furniture_files_contractor_idx ON furniture_files(assigned_contractor_id);
CREATE INDEX IF NOT EXISTS furniture_files_kind_idx ON furniture_files(file_kind);
CREATE INDEX IF NOT EXISTS furniture_files_created_at_idx ON furniture_files(created_at DESC);
CREATE INDEX IF NOT EXISTS furniture_file_logs_file_idx ON furniture_file_logs(furniture_file_id);

COMMIT;
