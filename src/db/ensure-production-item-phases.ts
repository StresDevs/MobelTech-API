import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

export function ensureProductionItemPhasesSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type
            WHERE typname = 'production_phase'
          ) THEN
            CREATE TYPE production_phase AS ENUM (
              'cortado',
              'canteado',
              'ensamblado',
              'instalacion',
              'entregado'
            );
          END IF;
        END $$;
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS production_item_phases (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
          phase production_phase NOT NULL,
          completed varchar(5) NOT NULL DEFAULT 'false',
          completed_date timestamptz
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS production_item_phases_item_idx
        ON production_item_phases(production_item_id)
      `;

      console.log('✅ Production item phases schema is ready.');
    })();
  }

  return ensurePromise;
}
