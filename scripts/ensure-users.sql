DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'user_role'
  ) THEN
    CREATE TYPE user_role AS ENUM ('admin', 'contractor', 'architect', 'partner');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'user_status'
  ) THEN
    CREATE TYPE user_status AS ENUM ('active', 'inactive');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role'
      AND e.enumlabel = 'partner'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'partner';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  username varchar(100) NOT NULL,
  email varchar(255) NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'admin',
  status user_status NOT NULL DEFAULT 'active',
  must_change_password boolean NOT NULL DEFAULT true,
  avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username varchar(100);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status user_status NOT NULL DEFAULT 'active';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar text;

UPDATE users
SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9]+', '.', 'g'))
WHERE username IS NULL OR username = '';

UPDATE users
SET username = regexp_replace(username, '(^\\.|\\.$)', '', 'g')
WHERE username IS NOT NULL;

DO $$
DECLARE
  r RECORD;
  base_username text;
  candidate text;
  suffix integer;
BEGIN
  FOR r IN
    SELECT id, username
    FROM users
    WHERE username IS NOT NULL
    ORDER BY created_at, id
  LOOP
    base_username := regexp_replace(lower(r.username), '(^\\.|\\.$)', '', 'g');
    IF base_username IS NULL OR base_username = '' THEN
      base_username := 'usuario';
    END IF;

    candidate := base_username;
    suffix := 1;

    WHILE EXISTS (
      SELECT 1
      FROM users u
      WHERE u.username = candidate
        AND u.id <> r.id
    ) LOOP
      candidate := base_username || '.' || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE users
    SET username = candidate
    WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON users(username);

UPDATE users
SET email = username || '@mobeltech.local'
WHERE email IS NULL OR email = '';
