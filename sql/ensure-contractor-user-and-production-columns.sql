ALTER TABLE "contractors"
ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id");

ALTER TABLE "production_orders"
ADD COLUMN IF NOT EXISTS "quotation_id" uuid REFERENCES "quotations"("id");

ALTER TABLE "production_orders"
ADD COLUMN IF NOT EXISTS "actual_delivery_date" date;

ALTER TABLE "production_orders"
ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE "production_orders"
ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone NOT NULL DEFAULT now();
