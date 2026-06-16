DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'production_schedule_type'
  ) THEN
    CREATE TYPE "production_schedule_type" AS ENUM ('tentative', 'actual');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'production_phase'
  ) THEN
    CREATE TYPE "production_phase" AS ENUM ('cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "production_schedule_phases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "production_order_id" uuid NOT NULL REFERENCES "production_orders"("id") ON DELETE CASCADE,
  "type" "production_schedule_type" NOT NULL,
  "phase" "production_phase" NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "production_schedule_phases_order_type_idx"
ON "production_schedule_phases" ("production_order_id", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "production_schedule_phases_order_type_phase_idx"
ON "production_schedule_phases" ("production_order_id", "type", "phase");
