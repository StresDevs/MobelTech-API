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
    ALTER TABLE "production_schedule_phases"
    ADD COLUMN IF NOT EXISTS "cutting_machine" varchar(20)
  `;

  console.log('Production schedule cutting machine schema is ready.');
}

main().catch((error) => {
  console.error('Failed to update production schedule cutting machine schema:', error);
  process.exit(1);
});

