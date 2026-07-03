ALTER TABLE contractor_payment_plans
  ADD COLUMN IF NOT EXISTS estimated_schedule jsonb;

ALTER TABLE contractor_labor_catalog_items
  ADD COLUMN IF NOT EXISTS enable_height boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_width_quantity boolean NOT NULL DEFAULT true;

ALTER TABLE contractor_payment_plan_lines
  ADD COLUMN IF NOT EXISTS enable_height boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS enable_width_quantity boolean NOT NULL DEFAULT true;
