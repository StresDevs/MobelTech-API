ALTER TABLE contractor_payment_plans
  ADD COLUMN IF NOT EXISTS estimated_schedule jsonb;

ALTER TABLE contractor_labor_catalog_items
  ADD COLUMN IF NOT EXISTS enable_height boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_width_quantity boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_height numeric(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_width_quantity numeric(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS use_default_height boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS use_default_width_quantity boolean NOT NULL DEFAULT false;

ALTER TABLE contractor_payment_plan_lines
  ADD COLUMN IF NOT EXISTS enable_height boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_width_quantity boolean NOT NULL DEFAULT true;
