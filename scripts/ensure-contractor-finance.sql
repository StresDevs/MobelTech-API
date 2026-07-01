CREATE TABLE IF NOT EXISTS contractor_payment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payment_plans_unique_job UNIQUE (contractor_id, production_order_id)
);

CREATE TABLE IF NOT EXISTS contractor_payment_plan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES contractor_payment_plans(id) ON DELETE CASCADE,
  phase_key varchar(60) NOT NULL,
  phase_label varchar(120) NOT NULL,
  unit varchar(30) NOT NULL DEFAULT 'UND',
  width numeric(12, 3) NOT NULL DEFAULT 0,
  height_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  measured_total numeric(12, 3) NOT NULL DEFAULT 0,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  planned_amount numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contractor_payment_plan_lines
  ALTER COLUMN phase_key TYPE varchar(60),
  ADD COLUMN IF NOT EXISTS unit varchar(30) NOT NULL DEFAULT 'UND',
  ADD COLUMN IF NOT EXISTS width numeric(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS height_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS measured_total numeric(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS contractor_labor_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key varchar(60) NOT NULL UNIQUE,
  label varchar(160) NOT NULL,
  unit varchar(30) NOT NULL DEFAULT 'UND',
  default_amount numeric(12, 2) NOT NULL DEFAULT 0,
  active varchar(5) NOT NULL DEFAULT 'true',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contractor_labor_catalog_items
  ADD COLUMN IF NOT EXISTS item_key varchar(60),
  ADD COLUMN IF NOT EXISTS label varchar(160),
  ADD COLUMN IF NOT EXISTS unit varchar(30) NOT NULL DEFAULT 'UND',
  ADD COLUMN IF NOT EXISTS default_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active varchar(5) NOT NULL DEFAULT 'true',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS contractor_labor_catalog_items_key_idx
  ON contractor_labor_catalog_items(item_key);

CREATE TABLE IF NOT EXISTS contractor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES contractor_payment_plans(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES contractor_payment_plan_lines(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contractor_payment_plans_contractor_idx
  ON contractor_payment_plans(contractor_id);

CREATE INDEX IF NOT EXISTS contractor_payment_plans_job_idx
  ON contractor_payment_plans(production_order_id);

CREATE INDEX IF NOT EXISTS contractor_payment_lines_plan_idx
  ON contractor_payment_plan_lines(plan_id, sort_order);

CREATE INDEX IF NOT EXISTS contractor_payments_plan_date_idx
  ON contractor_payments(plan_id, payment_date DESC);
