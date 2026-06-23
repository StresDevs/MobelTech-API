BEGIN;

ALTER TABLE inventory_return_claims
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_return_claims_supplier_id
  ON inventory_return_claims(supplier_id);

COMMIT;
