CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  code varchar(30) NOT NULL,
  location text,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE warehouses
SET
  location = COALESCE(location, name),
  code = COALESCE(NULLIF(code, ''), upper(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
WHERE TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_name_unique_idx
  ON warehouses(name);

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_code_unique_idx
  ON warehouses(code);

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_name varchar(160);
