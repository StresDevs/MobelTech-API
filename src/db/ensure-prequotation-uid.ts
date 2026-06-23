import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

export function ensurePrequotationUidSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS prequotation_uid_counters (
          uid_date date PRIMARY KEY,
          next_sequence integer NOT NULL DEFAULT 1,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        ALTER TABLE prequotations
          ADD COLUMN IF NOT EXISTS uid varchar(24),
          ADD COLUMN IF NOT EXISTS uid_assigned_at timestamptz
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND tablename = 'prequotations'
              AND indexname = 'prequotations_uid_unique_idx'
          ) THEN
            CREATE UNIQUE INDEX prequotations_uid_unique_idx
              ON prequotations(uid)
              WHERE uid IS NOT NULL;
          END IF;
        END $$;
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND tablename = 'prequotation_uid_counters'
              AND indexname = 'prequotation_uid_counters_updated_at_idx'
          ) THEN
            CREATE INDEX prequotation_uid_counters_updated_at_idx
              ON prequotation_uid_counters(updated_at DESC);
          END IF;
        END $$;
      `;

      await sql`
        CREATE OR REPLACE FUNCTION prequotation_uid_letters(seq integer)
        RETURNS text
        LANGUAGE plpgsql
        IMMUTABLE
        AS $$
        DECLARE
          n integer := seq;
          result text := '';
          remainder integer;
        BEGIN
          IF n < 1 THEN
            RAISE EXCEPTION 'Sequence must be positive';
          END IF;

          WHILE n > 0 LOOP
            n := n - 1;
            remainder := n % 26;
            result := chr(65 + remainder) || result;
            n := n / 26;
          END LOOP;

          RETURN result;
        END;
        $$;
      `;

      await sql`
        CREATE OR REPLACE FUNCTION prequotation_uid_sequence(uid_code text)
        RETURNS integer
        LANGUAGE plpgsql
        IMMUTABLE
        AS $$
        DECLARE
          suffix text := regexp_replace(uid_code, '^[0-9]{8}', '');
          result integer := 0;
          i integer;
          ch text;
        BEGIN
          IF suffix = '' THEN
            RETURN 0;
          END IF;

          FOR i IN 1..char_length(suffix) LOOP
            ch := substr(suffix, i, 1);
            result := result * 26 + (ascii(ch) - 64);
          END LOOP;

          RETURN result;
        END;
        $$;
      `;

      await sql`
        INSERT INTO prequotation_uid_counters (uid_date, next_sequence, updated_at)
        SELECT
          COALESCE(uid_assigned_at::date, to_date(substring(uid from 1 for 8), 'DDMMYYYY')) AS uid_date,
          MAX(prequotation_uid_sequence(uid)) + 1,
          now()
        FROM prequotations
        WHERE uid IS NOT NULL
        GROUP BY 1
        ON CONFLICT (uid_date) DO UPDATE
          SET next_sequence = GREATEST(prequotation_uid_counters.next_sequence, EXCLUDED.next_sequence),
              updated_at = now()
      `;

      console.log('✅ Prequotation UID schema is ready.');
    })();
  }

  return ensurePromise;
}
