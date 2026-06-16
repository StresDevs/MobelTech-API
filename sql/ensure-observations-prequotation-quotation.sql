CREATE TABLE IF NOT EXISTS project_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  assigned_contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
  ambience varchar(160) NOT NULL,
  description text,
  price numeric(12, 2) NOT NULL DEFAULT 0,
  estimated_start_date date NOT NULL,
  estimated_end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prequotations
  ADD COLUMN IF NOT EXISTS advance_amount numeric(12, 2);

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS advance_amount numeric(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_project_environments_quotation_id
  ON project_environments (quotation_id);

CREATE INDEX IF NOT EXISTS idx_project_environments_project_id
  ON project_environments (project_id);

CREATE INDEX IF NOT EXISTS idx_project_environments_contractor_id
  ON project_environments (assigned_contractor_id);
