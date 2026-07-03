CREATE TABLE IF NOT EXISTS quotation_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  field varchar(120) NOT NULL,
  previous_value text NOT NULL,
  next_value text NOT NULL,
  comment text,
  changed_by varchar(255) NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quotation_audit_logs
  ADD COLUMN IF NOT EXISTS comment text;

CREATE INDEX IF NOT EXISTS quotation_audit_logs_quotation_idx
  ON quotation_audit_logs(quotation_id, changed_at DESC);
