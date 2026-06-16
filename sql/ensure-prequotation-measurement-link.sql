-- Adds the missing link between prequotations and measurements.
-- Safe to run more than once in Neon.

ALTER TABLE "prequotations"
ADD COLUMN IF NOT EXISTS "measurement_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'prequotations_measurement_id_measurements_id_fk'
  ) THEN
    ALTER TABLE "prequotations"
    ADD CONSTRAINT "prequotations_measurement_id_measurements_id_fk"
    FOREIGN KEY ("measurement_id")
    REFERENCES "measurements"("id")
    ON DELETE SET NULL;
  END IF;
END
$$;

-- One measurement should only have one linked prequotation.
-- The partial index allows many rows with measurement_id = NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "prequotations_measurement_id_unique_idx"
ON "prequotations" ("measurement_id")
WHERE "measurement_id" IS NOT NULL;
