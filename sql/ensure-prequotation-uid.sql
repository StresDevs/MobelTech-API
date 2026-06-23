BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS prequotation_uid_counters (
  uid_date date PRIMARY KEY,
  next_sequence integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prequotations
  ADD COLUMN IF NOT EXISTS uid varchar(24),
  ADD COLUMN IF NOT EXISTS uid_assigned_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS prequotations_uid_unique_idx
  ON prequotations(uid)
  WHERE uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prequotations_uid_assigned_at
  ON prequotations(uid_assigned_at DESC);

CREATE INDEX IF NOT EXISTS prequotation_uid_counters_updated_at_idx
  ON prequotation_uid_counters(updated_at DESC);

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
      updated_at = now();

DO $$
DECLARE
  rec record;
  assigned_date date;
  sequence_number integer;
BEGIN
  FOR rec IN
    SELECT
      p.id,
      COALESCE(
        (
          SELECT l.performed_at
          FROM prequotation_logs l
          WHERE l.prequotation_id = p.id
            AND l.action = 'status_changed'
          ORDER BY l.performed_at ASC
          LIMIT 1
        ),
        p.updated_at,
        p.created_at
      ) AS assigned_at
    FROM prequotations p
    WHERE p.uid IS NULL
      AND p.status <> 'draft'
    ORDER BY assigned_at ASC, p.id ASC
  LOOP
    assigned_date := rec.assigned_at::date;

    INSERT INTO prequotation_uid_counters (uid_date, next_sequence, updated_at)
    VALUES (assigned_date, 1, now())
    ON CONFLICT (uid_date) DO UPDATE
      SET next_sequence = prequotation_uid_counters.next_sequence + 1,
          updated_at = now()
    RETURNING next_sequence INTO sequence_number;

    UPDATE prequotations
      SET uid = to_char(assigned_date, 'DDMMYYYY') || prequotation_uid_letters(sequence_number),
          uid_assigned_at = rec.assigned_at
      WHERE id = rec.id;
  END LOOP;
END $$;

COMMIT;
