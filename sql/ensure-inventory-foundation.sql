-- Base de inventario para MobelTech
-- Seguro para ejecutar múltiples veces en Neon/PostgreSQL.
-- Crea estructura mínima para:
-- proveedores, almacenes, materiales, historial de precios,
-- órdenes de compra, defectos, reclamos y sobrantes.
-- También deja 10+ materiales de prueba listos para solicitudes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_status') THEN
    CREATE TYPE supplier_status AS ENUM ('active', 'inactive');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE purchase_order_status AS ENUM ('draft', 'submitted', 'partial', 'received', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_defect_status') THEN
    CREATE TYPE inventory_defect_status AS ENUM ('nuevo', 'reportado', 'en-gestion', 'resuelto');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_claim_status') THEN
    CREATE TYPE inventory_claim_status AS ENUM ('abierto', 'en-revision', 'resuelto');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_surplus_class') THEN
    CREATE TYPE inventory_surplus_class AS ENUM ('reutilizable', 'desecho');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL UNIQUE,
  code varchar(30) NOT NULL UNIQUE,
  location text,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  phone varchar(50) NOT NULL,
  email varchar(255),
  address text,
  products_provided text[],
  status supplier_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS nit varchar(80),
  ADD COLUMN IF NOT EXISTS supplier_type varchar(100),
  ADD COLUMN IF NOT EXISTS purchase_history_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_delays integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defects_rate numeric(6, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_price_competitiveness numeric(6, 2) NOT NULL DEFAULT 75;

CREATE TABLE IF NOT EXISTS materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  unit_price numeric(12, 2) NOT NULL,
  stock integer NOT NULL DEFAULT 0,
  unit varchar(50) NOT NULL,
  last_purchase_date date,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS sku varchar(80),
  ADD COLUMN IF NOT EXISTS category varchar(120) NOT NULL DEFAULT 'Materia prima',
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_name varchar(160),
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS stock_physical integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_reserved integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_by_defect integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_url text;

UPDATE materials
SET
  stock_physical = CASE WHEN stock_physical = 0 THEN stock ELSE stock_physical END,
  image_url = COALESCE(image_url, image),
  purchase_date = COALESCE(purchase_date, last_purchase_date),
  warehouse_name = COALESCE(warehouse_name, 'Almacén Central')
WHERE TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_sku_unique
  ON materials (sku)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_materials_name
  ON materials (name);

CREATE INDEX IF NOT EXISTS idx_materials_supplier_id
  ON materials (supplier_id);

CREATE TABLE IF NOT EXISTS material_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  price_bs numeric(12, 2) NOT NULL,
  exchange_rate numeric(10, 4) NOT NULL DEFAULT 6.96,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_price_history_material
  ON material_price_history (material_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS material_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  project_name varchar(255) NOT NULL,
  used_on date NOT NULL,
  quantity numeric(12, 2) NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  reference_code varchar(60) NOT NULL UNIQUE,
  status purchase_order_status NOT NULL DEFAULT 'draft',
  requested_by varchar(160),
  notes text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id),
  quantity numeric(12, 2) NOT NULL,
  unit_price_bs numeric(12, 2) NOT NULL,
  received_quantity numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_defect_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  defect_type varchar(200) NOT NULL,
  affected_quantity integer NOT NULL,
  status inventory_defect_status NOT NULL DEFAULT 'nuevo',
  supplier_report_sent boolean NOT NULL DEFAULT false,
  created_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by varchar(160)
);

CREATE TABLE IF NOT EXISTS inventory_return_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_ref varchar(60) NOT NULL,
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  material_id uuid NOT NULL REFERENCES materials(id),
  reason text NOT NULL,
  status inventory_claim_status NOT NULL DEFAULT 'abierto',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_surplus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id),
  quantity numeric(12, 2) NOT NULL,
  origin text NOT NULL,
  classification inventory_surplus_class NOT NULL,
  reintegrated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO warehouses (name, code, location)
VALUES
  ('Almacén Central - La Paz', 'LP-CENTRAL', 'La Paz'),
  ('Almacén Secundario - Santa Cruz', 'SC-SEC', 'Santa Cruz'),
  ('Almacén Tapizados - Cochabamba', 'CBB-TAP', 'Cochabamba')
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  location = EXCLUDED.location,
  updated_at = now();

INSERT INTO suppliers (
  name,
  nit,
  phone,
  email,
  address,
  supplier_type,
  products_provided,
  purchase_history_count,
  delivery_delays,
  defects_rate,
  avg_price_competitiveness,
  status
)
VALUES
  (
    'Maderas Selectas Bolivia',
    '1029384018',
    '+591 2 4444444',
    'ventas@maderasselectas.bo',
    'Zona Industrial, La Paz',
    'Madera',
    ARRAY['MDF', 'Melamina', 'Tableros'],
    28,
    2,
    1.80,
    84,
    'active'
  ),
  (
    'Herrajes Andinos SRL',
    '2398741201',
    '+591 3 6666666',
    'compras@herrajesandinos.bo',
    'Parque Industrial, Santa Cruz',
    'Herrajes',
    ARRAY['Bisagras', 'Correderas', 'Tornillos'],
    34,
    4,
    2.10,
    88,
    'active'
  ),
  (
    'Textiles Premium BO',
    '5546789921',
    '+591 2 7777777',
    'pedidos@textilespremium.bo',
    'Zona Comercial, Cochabamba',
    'Telas',
    ARRAY['Tapicería', 'Lonas', 'Espumas'],
    22,
    1,
    1.20,
    81,
    'active'
  ),
  (
    'Químicos y Adhesivos del Sur',
    '6612349988',
    '+591 4 3322110',
    'ventas@adhesivossur.bo',
    'Avenida Petrolera, Cochabamba',
    'Insumos',
    ARRAY['Pegamentos', 'Lacas', 'Selladores'],
    19,
    2,
    1.40,
    79,
    'active'
  )
ON CONFLICT DO NOTHING;

WITH refs AS (
  SELECT
    (SELECT id FROM suppliers WHERE name = 'Maderas Selectas Bolivia' LIMIT 1) AS supp_maderas,
    (SELECT id FROM suppliers WHERE name = 'Herrajes Andinos SRL' LIMIT 1) AS supp_herrajes,
    (SELECT id FROM suppliers WHERE name = 'Textiles Premium BO' LIMIT 1) AS supp_textiles,
    (SELECT id FROM suppliers WHERE name = 'Químicos y Adhesivos del Sur' LIMIT 1) AS supp_quimicos,
    (SELECT id FROM warehouses WHERE code = 'LP-CENTRAL' LIMIT 1) AS wh_lp,
    (SELECT id FROM warehouses WHERE code = 'SC-SEC' LIMIT 1) AS wh_sc,
    (SELECT id FROM warehouses WHERE code = 'CBB-TAP' LIMIT 1) AS wh_cbb
)
INSERT INTO materials (
  name,
  supplier_id,
  unit_price,
  stock,
  unit,
  last_purchase_date,
  image,
  sku,
  category,
  warehouse_id,
  warehouse_name,
  purchase_date,
  stock_physical,
  stock_reserved,
  blocked_by_defect,
  min_stock,
  image_url
)
SELECT *
FROM (
  SELECT
    'Madera MDF 18mm',
    refs.supp_maderas,
    450.00,
    64,
    'pliego',
    DATE '2026-03-20',
    NULL,
    'MDF-18-001',
    'Materia prima',
    refs.wh_lp,
    'Almacén Central - La Paz',
    DATE '2026-03-20',
    64,
    22,
    0,
    25,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Melamina Roble Natural 18mm',
    refs.supp_maderas,
    520.00,
    46,
    'pliego',
    DATE '2026-04-02',
    NULL,
    'MEL-RN-018',
    'Materia prima',
    refs.wh_lp,
    'Almacén Central - La Paz',
    DATE '2026-04-02',
    46,
    12,
    0,
    20,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Triplay 15mm',
    refs.supp_maderas,
    390.00,
    38,
    'pliego',
    DATE '2026-03-28',
    NULL,
    'TRI-15-003',
    'Materia prima',
    refs.wh_lp,
    'Almacén Central - La Paz',
    DATE '2026-03-28',
    38,
    8,
    0,
    16,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Bisagra Cazoleta 35mm',
    refs.supp_herrajes,
    45.00,
    420,
    'unidad',
    DATE '2026-03-18',
    NULL,
    'HER-BIS-035',
    'Herrajes',
    refs.wh_sc,
    'Almacén Secundario - Santa Cruz',
    DATE '2026-03-18',
    420,
    130,
    15,
    160,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Corredera Telescópica 45cm',
    refs.supp_herrajes,
    62.00,
    180,
    'par',
    DATE '2026-03-26',
    NULL,
    'HER-COR-450',
    'Herrajes',
    refs.wh_sc,
    'Almacén Secundario - Santa Cruz',
    DATE '2026-03-26',
    180,
    42,
    0,
    70,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Tornillo Confirmat 7x50',
    refs.supp_herrajes,
    0.90,
    5000,
    'unidad',
    DATE '2026-04-05',
    NULL,
    'HER-TOR-750',
    'Herrajes',
    refs.wh_sc,
    'Almacén Secundario - Santa Cruz',
    DATE '2026-04-05',
    5000,
    600,
    0,
    1200,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Tela Tapicería Premium Gris',
    refs.supp_textiles,
    85.00,
    190,
    'metro',
    DATE '2026-03-21',
    NULL,
    'TEL-TP-090',
    'Telas',
    refs.wh_cbb,
    'Almacén Tapizados - Cochabamba',
    DATE '2026-03-21',
    190,
    70,
    0,
    80,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Espuma Densidad 26',
    refs.supp_textiles,
    145.00,
    72,
    'plancha',
    DATE '2026-04-01',
    NULL,
    'ESP-D26-001',
    'Telas',
    refs.wh_cbb,
    'Almacén Tapizados - Cochabamba',
    DATE '2026-04-01',
    72,
    12,
    0,
    24,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Pegamento de Contacto 1L',
    refs.supp_quimicos,
    68.00,
    95,
    'litro',
    DATE '2026-04-08',
    NULL,
    'INS-PEG-1L',
    'Insumos',
    refs.wh_lp,
    'Almacén Central - La Paz',
    DATE '2026-04-08',
    95,
    10,
    0,
    30,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Laca Catalizada Mate',
    refs.supp_quimicos,
    120.00,
    54,
    'galón',
    DATE '2026-04-03',
    NULL,
    'INS-LAC-MAT',
    'Insumos',
    refs.wh_lp,
    'Almacén Central - La Paz',
    DATE '2026-04-03',
    54,
    6,
    0,
    18,
    NULL
  FROM refs
  UNION ALL
  SELECT
    'Canto PVC 22mm Blanco',
    refs.supp_herrajes,
    32.00,
    140,
    'rollo',
    DATE '2026-03-30',
    NULL,
    'HER-CAN-22B',
    'Herrajes',
    refs.wh_sc,
    'Almacén Secundario - Santa Cruz',
    DATE '2026-03-30',
    140,
    18,
    0,
    40,
    NULL
  FROM refs
) seeded (
  name,
  supplier_id,
  unit_price,
  stock,
  unit,
  last_purchase_date,
  image,
  sku,
  category,
  warehouse_id,
  warehouse_name,
  purchase_date,
  stock_physical,
  stock_reserved,
  blocked_by_defect,
  min_stock,
  image_url
)
WHERE NOT EXISTS (
  SELECT 1
  FROM materials existing
  WHERE existing.sku = seeded.sku
);

INSERT INTO material_price_history (material_id, effective_date, price_bs, exchange_rate, notes)
SELECT material_id, effective_date, price_bs, exchange_rate, notes
FROM (
  SELECT
    m.id AS material_id,
    x.effective_date,
    x.price_bs,
    x.exchange_rate,
    x.notes
  FROM materials m
  JOIN (
    VALUES
      ('MDF-18-001', DATE '2026-01-10', 410.00, 6.96, 'Primer lote'),
      ('MDF-18-001', DATE '2026-02-15', 430.00, 6.95, 'Ajuste proveedor'),
      ('MDF-18-001', DATE '2026-03-20', 450.00, 6.96, 'Compra vigente'),
      ('HER-BIS-035', DATE '2026-01-11', 38.00, 6.96, 'Precio histórico'),
      ('HER-BIS-035', DATE '2026-02-09', 42.00, 6.95, 'Lote importado'),
      ('HER-BIS-035', DATE '2026-03-18', 45.00, 6.96, 'Precio vigente'),
      ('TEL-TP-090', DATE '2026-01-07', 72.00, 6.96, 'Inicio de temporada'),
      ('TEL-TP-090', DATE '2026-02-17', 78.00, 6.95, 'Revisión intermedia'),
      ('TEL-TP-090', DATE '2026-03-21', 85.00, 6.96, 'Precio vigente'),
      ('INS-PEG-1L', DATE '2026-03-01', 61.00, 6.96, 'Compra previa'),
      ('INS-PEG-1L', DATE '2026-04-08', 68.00, 6.96, 'Precio vigente')
  ) AS x(sku, effective_date, price_bs, exchange_rate, notes)
    ON x.sku = m.sku
) seeded
WHERE NOT EXISTS (
  SELECT 1
  FROM material_price_history mph
  WHERE mph.material_id = seeded.material_id
    AND mph.effective_date = seeded.effective_date
    AND mph.price_bs = seeded.price_bs
);

INSERT INTO material_usage_logs (material_id, project_name, used_on, quantity, notes)
SELECT material_id, project_name, used_on, quantity, notes
FROM (
  SELECT m.id AS material_id, 'Proyecto Hotel Andino', DATE '2026-03-25', 12.00, 'Uso en mobiliario de habitaciones'
  FROM materials m WHERE m.sku = 'MDF-18-001'
  UNION ALL
  SELECT m.id, 'Oficinas Garcia', DATE '2026-03-22', 9.00, 'Escritorios ejecutivos'
  FROM materials m WHERE m.sku = 'MDF-18-001'
  UNION ALL
  SELECT m.id, 'Torres Empresariales', DATE '2026-03-24', 75.00, 'Cocinas modulares'
  FROM materials m WHERE m.sku = 'HER-BIS-035'
  UNION ALL
  SELECT m.id, 'Restaurant El Parador', DATE '2026-03-26', 28.00, 'Tapizado de bancas'
  FROM materials m WHERE m.sku = 'TEL-TP-090'
) seeded(material_id, project_name, used_on, quantity, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM material_usage_logs mul
  WHERE mul.material_id = seeded.material_id
    AND mul.project_name = seeded.project_name
    AND mul.used_on = seeded.used_on
);

INSERT INTO purchase_orders (supplier_id, reference_code, status, requested_by, notes, ordered_at)
SELECT
  s.id,
  'PO-2026-118',
  'submitted',
  'Sistema',
  'Orden de prueba para reclamos y devoluciones',
  now()
FROM suppliers s
WHERE s.name = 'Herrajes Andinos SRL'
  AND NOT EXISTS (
    SELECT 1 FROM purchase_orders po WHERE po.reference_code = 'PO-2026-118'
  );

INSERT INTO purchase_order_items (purchase_order_id, material_id, quantity, unit_price_bs, received_quantity)
SELECT
  po.id,
  m.id,
  120,
  45.00,
  120
FROM purchase_orders po
JOIN materials m ON m.sku = 'HER-BIS-035'
WHERE po.reference_code = 'PO-2026-118'
  AND NOT EXISTS (
    SELECT 1
    FROM purchase_order_items poi
    WHERE poi.purchase_order_id = po.id
      AND poi.material_id = m.id
  );

INSERT INTO inventory_defect_alerts (
  material_id,
  supplier_id,
  defect_type,
  affected_quantity,
  status,
  supplier_report_sent,
  created_at,
  notes,
  created_by
)
SELECT
  m.id,
  s.id,
  'Oxidación prematura',
  15,
  'reportado',
  true,
  DATE '2026-03-24',
  'Caso de prueba inicial',
  'Sistema'
FROM materials m
JOIN suppliers s ON s.id = m.supplier_id
WHERE m.sku = 'HER-BIS-035'
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_defect_alerts ida
    WHERE ida.material_id = m.id
      AND ida.defect_type = 'Oxidación prematura'
      AND ida.created_at = DATE '2026-03-24'
  );

INSERT INTO inventory_return_claims (
  purchase_order_ref,
  purchase_order_id,
  material_id,
  reason,
  status
)
SELECT
  'PO-2026-118',
  po.id,
  m.id,
  'Lote defectuoso reportado en línea de ensamblado',
  'en-revision'
FROM purchase_orders po
JOIN materials m ON m.sku = 'HER-BIS-035'
WHERE po.reference_code = 'PO-2026-118'
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_return_claims irc
    WHERE irc.purchase_order_ref = 'PO-2026-118'
      AND irc.material_id = m.id
  );

INSERT INTO inventory_surplus (
  material_id,
  quantity,
  origin,
  classification,
  reintegrated
)
SELECT
  m.id,
  7,
  'Producción Proyecto Hotel Andino',
  'reutilizable',
  false
FROM materials m
WHERE m.sku = 'MDF-18-001'
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_surplus s
    WHERE s.material_id = m.id
      AND s.origin = 'Producción Proyecto Hotel Andino'
  );

INSERT INTO inventory_surplus (
  material_id,
  quantity,
  origin,
  classification,
  reintegrated
)
SELECT
  m.id,
  4,
  'Compra en exceso lote febrero',
  'desecho',
  false
FROM materials m
WHERE m.sku = 'TEL-TP-090'
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_surplus s
    WHERE s.material_id = m.id
      AND s.origin = 'Compra en exceso lote febrero'
  );
