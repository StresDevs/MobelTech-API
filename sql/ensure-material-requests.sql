DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'material_request_status'
  ) THEN
    CREATE TYPE material_request_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS material_requests (
  id uuid PRIMARY KEY,
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  production_order_id uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status material_request_status NOT NULL DEFAULT 'pending',
  rejection_comments text,
  admin_notes text,
  request_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_request_items (
  id uuid PRIMARY KEY,
  material_request_id uuid NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS material_requests_contractor_idx
  ON material_requests(contractor_id, request_date DESC);

CREATE INDEX IF NOT EXISTS material_requests_status_idx
  ON material_requests(status, request_date DESC);

CREATE INDEX IF NOT EXISTS material_request_items_request_idx
  ON material_request_items(material_request_id);
