CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contractor_payment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  review_status varchar(40) NOT NULL DEFAULT 'submitted',
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_payment_plans_unique_job UNIQUE (contractor_id, production_order_id)
);

ALTER TABLE contractor_payment_plans
  ADD COLUMN IF NOT EXISTS review_status varchar(40) NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS review_notes text;

CREATE TABLE IF NOT EXISTS contractor_payment_plan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES contractor_payment_plans(id) ON DELETE CASCADE,
  phase_key varchar(40) NOT NULL,
  phase_label varchar(120) NOT NULL,
  planned_amount numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contractor_labor_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key varchar(60) NOT NULL UNIQUE,
  label varchar(160) NOT NULL,
  default_amount numeric(12, 2) NOT NULL DEFAULT 0,
  active varchar(5) NOT NULL DEFAULT 'true',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contractor_labor_catalog_items
  ADD COLUMN IF NOT EXISTS item_key varchar(60),
  ADD COLUMN IF NOT EXISTS label varchar(160),
  ADD COLUMN IF NOT EXISTS default_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active varchar(5) NOT NULL DEFAULT 'true',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS contractor_labor_catalog_items_key_idx
  ON contractor_labor_catalog_items(item_key);

DELETE FROM contractor_labor_catalog_items
WHERE item_key IN ('corte', 'canteado', 'ensamblado', 'instalacion', 'acabado');

CREATE TABLE IF NOT EXISTS contractor_advance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES contractor_payment_plans(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  status varchar(40) NOT NULL DEFAULT 'submitted',
  notes text,
  review_notes text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contractor_advance_requests
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES contractor_payment_plans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES contractors(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status varchar(40) NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

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

CREATE INDEX IF NOT EXISTS contractor_payments_plan_date_idx
  ON contractor_payments(plan_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS contractor_advance_requests_plan_idx
  ON contractor_advance_requests(plan_id, requested_at DESC);
