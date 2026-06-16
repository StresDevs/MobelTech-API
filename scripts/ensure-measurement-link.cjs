require('dotenv/config');
const { neon } = require('@neondatabase/serverless');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required to update the database schema.');
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  await sql`
    ALTER TABLE "prequotations"
    ADD COLUMN IF NOT EXISTS "measurement_id" uuid
  `;

  await sql`
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
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "prequotations_measurement_id_unique_idx"
    ON "prequotations" ("measurement_id")
    WHERE "measurement_id" IS NOT NULL
  `;

  console.log('Measurement/prequotation link schema is ready.');
}

main().catch((error) => {
  console.error('Failed to update measurement/prequotation link schema:', error);
  process.exit(1);
});
