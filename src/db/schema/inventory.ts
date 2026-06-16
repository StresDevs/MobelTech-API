import {
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const supplierStatusEnum = pgEnum('supplier_status', [
  'active',
  'inactive',
]);

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'draft',
  'submitted',
  'partial',
  'received',
  'cancelled',
]);

export const inventoryDefectStatusEnum = pgEnum('inventory_defect_status', [
  'nuevo',
  'reportado',
  'en-gestion',
  'resuelto',
]);

export const inventoryClaimStatusEnum = pgEnum('inventory_claim_status', [
  'abierto',
  'en-revision',
  'resuelto',
]);

export const inventorySurplusClassEnum = pgEnum('inventory_surplus_class', [
  'reutilizable',
  'desecho',
]);

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  code: varchar('code', { length: 30 }).notNull(),
  location: text('location'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  nit: varchar('nit', { length: 80 }),
  phone: varchar('phone', { length: 50 }).notNull(),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  supplierType: varchar('supplier_type', { length: 100 }),
  productsProvided: text('products_provided').array(),
  purchaseHistoryCount: integer('purchase_history_count').notNull().default(0),
  deliveryDelays: integer('delivery_delays').notNull().default(0),
  defectsRate: numeric('defects_rate', { precision: 6, scale: 2 }).notNull().default('0'),
  avgPriceCompetitiveness: numeric('avg_price_competitiveness', { precision: 6, scale: 2 }).notNull().default('75'),
  status: supplierStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  stock: integer('stock').notNull().default(0),
  unit: varchar('unit', { length: 50 }).notNull(),
  lastPurchaseDate: date('last_purchase_date'),
  image: text('image'),
  sku: varchar('sku', { length: 80 }),
  category: varchar('category', { length: 120 }).notNull().default('Materia prima'),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
  warehouseName: varchar('warehouse_name', { length: 160 }),
  purchaseDate: date('purchase_date'),
  stockPhysical: integer('stock_physical').notNull().default(0),
  stockReserved: integer('stock_reserved').notNull().default(0),
  blockedByDefect: integer('blocked_by_defect').notNull().default(0),
  minStock: integer('min_stock').notNull().default(0),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const materialPriceHistory = pgTable('material_price_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id, { onDelete: 'cascade' }),
  effectiveDate: date('effective_date').notNull(),
  priceBs: numeric('price_bs', { precision: 12, scale: 2 }).notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 10, scale: 4 }).notNull().default('6.96'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const materialUsageLogs = pgTable('material_usage_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id, { onDelete: 'cascade' }),
  projectName: varchar('project_name', { length: 255 }).notNull(),
  usedOn: date('used_on').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  referenceCode: varchar('reference_code', { length: 60 }).notNull(),
  status: purchaseOrderStatusEnum('status').notNull().default('draft'),
  requestedBy: varchar('requested_by', { length: 160 }),
  notes: text('notes'),
  orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
  unitPriceBs: numeric('unit_price_bs', { precision: 12, scale: 2 }).notNull(),
  receivedQuantity: numeric('received_quantity', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryDefectAlerts = pgTable('inventory_defect_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  defectType: varchar('defect_type', { length: 200 }).notNull(),
  affectedQuantity: integer('affected_quantity').notNull(),
  status: inventoryDefectStatusEnum('status').notNull().default('nuevo'),
  supplierReportSent: boolean('supplier_report_sent').notNull().default(false),
  createdAt: date('created_at').notNull().defaultNow(),
  notes: text('notes'),
  createdBy: varchar('created_by', { length: 160 }),
});

export const inventoryReturnClaims = pgTable('inventory_return_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderRef: varchar('purchase_order_ref', { length: 60 }).notNull(),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id),
  reason: text('reason').notNull(),
  status: inventoryClaimStatusEnum('status').notNull().default('abierto'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inventorySurplus = pgTable('inventory_surplus', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id),
  quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
  origin: text('origin').notNull(),
  classification: inventorySurplusClassEnum('classification').notNull(),
  reintegrated: boolean('reintegrated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
