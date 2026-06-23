CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS image text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS sku varchar(80),
  ADD COLUMN IF NOT EXISTS category varchar(120) NOT NULL DEFAULT 'Materia prima',
  ADD COLUMN IF NOT EXISTS warehouse_name varchar(160),
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS stock_physical integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_reserved integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_by_defect integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 0;

UPDATE materials
SET
  image_url = COALESCE(image_url, image),
  image = COALESCE(image, image_url),
  stock_physical = CASE WHEN stock_physical = 0 THEN stock ELSE stock_physical END,
  purchase_date = COALESCE(purchase_date, last_purchase_date),
  warehouse_name = COALESCE(warehouse_name, 'Almacén Central')
WHERE TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_sku_unique
  ON materials (sku)
  WHERE sku IS NOT NULL;
