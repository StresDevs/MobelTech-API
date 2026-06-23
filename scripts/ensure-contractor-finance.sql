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
  phase_key varchar(40) NOT NULL,
  phase_label varchar(120) NOT NULL,
  planned_amount numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
