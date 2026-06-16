import { randomUUID } from 'crypto';
import { Router } from 'express';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  inventoryDefectAlerts,
  inventoryReturnClaims,
  inventorySurplus,
  materialPriceHistory,
  materialRequestItems,
  materialRequests,
  materialUsageLogs,
  materials,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  warehouses,
} from '../db/schema';
import { validate } from '../middleware/validate';

const router = Router();

const supplierSchema = z.object({
  name: z.string().min(1).max(255),
  nit: z.string().min(1).max(80),
  phone: z.string().min(1).max(50),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  address: z.string().optional().or(z.literal('')).nullable(),
  supplierType: z.string().min(1).max(100),
});

const materialSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().min(1).max(120),
  supplierId: z.string().uuid(),
  sku: z.string().min(1).max(80),
  unit: z.string().min(1).max(50),
  warehouse: z.string().min(1).max(160),
  purchaseDate: z.string().min(1),
  purchasePriceBs: z.union([z.number(), z.string()]),
  initialStock: z.union([z.number(), z.string()]),
  minStock: z.union([z.number(), z.string()]),
  imageUrl: z.string().optional().nullable(),
});

const materialUpdateSchema = materialSchema.partial().extend({
  purchasePriceBs: z.union([z.number(), z.string()]).optional(),
  minStock: z.union([z.number(), z.string()]).optional(),
});

const minStockSchema = z.object({
  minStock: z.union([z.number(), z.string()]),
});

const stockAdjustmentSchema = z.object({
  quantityToAdd: z.union([z.number(), z.string()]),
  newPriceBs: z.union([z.number(), z.string()]).optional().nullable(),
});

const defectSchema = z.object({
  materialId: z.string().uuid(),
  defectType: z.string().min(1).max(200),
  affectedQuantity: z.union([z.number(), z.string()]),
  createdBy: z.string().optional().nullable(),
});

const claimSchema = z.object({
  purchaseOrderRef: z.string().min(1).max(60),
  materialId: z.string().uuid(),
  reason: z.string().min(1),
});

const surplusSchema = z.object({
  materialId: z.string().uuid(),
  quantity: z.union([z.number(), z.string()]),
  origin: z.string().min(1),
  classification: z.enum(['reutilizable', 'desecho']),
});

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function slugCode(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'ALMACEN';
}

async function ensureWarehouseByName(name: string) {
  const trimmed = name.trim();
  const [existing] = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.name, trimmed));

  if (existing) return existing;

  const [created] = await db.insert(warehouses).values({
    id: randomUUID(),
    name: trimmed,
    code: `${slugCode(trimmed)}-${Date.now().toString().slice(-4)}`,
    location: trimmed,
  }).returning();

  return created;
}

async function hydrateMaterialRows(rows: typeof materials.$inferSelect[]) {
  if (rows.length === 0) return [];

  const materialIds = rows.map((row) => row.id);
  const [priceRows, usageRows] = await Promise.all([
    db
      .select()
      .from(materialPriceHistory)
      .where(inArray(materialPriceHistory.materialId, materialIds))
      .orderBy(asc(materialPriceHistory.effectiveDate)),
    db
      .select()
      .from(materialUsageLogs)
      .where(inArray(materialUsageLogs.materialId, materialIds))
      .orderBy(desc(materialUsageLogs.usedOn)),
  ]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    imageUrl: row.imageUrl ?? row.image ?? '',
    supplierId: row.supplierId,
    sku: row.sku ?? '',
    unit: row.unit,
    warehouse: row.warehouseName ?? 'Almacén',
    purchaseDate: row.purchaseDate ?? row.lastPurchaseDate ?? null,
    stockPhysical: Number(row.stockPhysical ?? row.stock ?? 0),
    stockReserved: Number(row.stockReserved ?? 0),
    blockedByDefect: Number(row.blockedByDefect ?? 0),
    minStock: Number(row.minStock ?? 0),
    priceHistory: priceRows
      .filter((entry) => entry.materialId === row.id)
      .map((entry) => ({
        date: entry.effectiveDate,
        priceBs: Number(entry.priceBs ?? 0),
        exchangeRate: Number(entry.exchangeRate ?? 0),
      })),
    recentUsage: usageRows
      .filter((entry) => entry.materialId === row.id)
      .slice(0, 5)
      .map((entry) => ({
        project: entry.projectName,
        date: entry.usedOn,
        quantity: Number(entry.quantity ?? 0),
      })),
  }));
}

async function hydrateRequests() {
  const rows = await db.select().from(materialRequests).orderBy(desc(materialRequests.requestDate));
  if (rows.length === 0) return [];

  const items = await db
    .select()
    .from(materialRequestItems)
    .where(inArray(materialRequestItems.materialRequestId, rows.map((row) => row.id)))
    .orderBy(asc(materialRequestItems.createdAt));

  return rows.map((row) => ({
    id: row.id,
    contractorId: row.contractorId,
    productionOrderId: row.productionOrderId,
    status: row.status,
    rejectionComments: row.rejectionComments,
    requestDate: row.requestDate,
    items: items
      .filter((item) => item.materialRequestId === row.id)
      .map((item) => ({
        materialId: item.materialId,
        quantity: Number(item.quantity ?? 0),
        notes: item.notes,
      })),
  }));
}

async function hydratePurchaseOrders() {
  const rows = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.orderedAt));
  if (rows.length === 0) return [];

  const items = await db
    .select()
    .from(purchaseOrderItems)
    .where(inArray(purchaseOrderItems.purchaseOrderId, rows.map((row) => row.id)))
    .orderBy(asc(purchaseOrderItems.createdAt));

  return rows.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    referenceCode: row.referenceCode,
    status: row.status,
    requestedBy: row.requestedBy,
    notes: row.notes,
    orderedAt: row.orderedAt,
    receivedAt: row.receivedAt,
    items: items
      .filter((item) => item.purchaseOrderId === row.id)
      .map((item) => ({
        materialId: item.materialId,
        quantity: Number(item.quantity ?? 0),
        unitPriceBs: Number(item.unitPriceBs ?? 0),
        receivedQuantity: Number(item.receivedQuantity ?? 0),
      })),
  }));
}

router.get('/overview', async (_req, res) => {
  const [supplierRows, materialRows, warehouseRows, defectRows, claimRows, surplusRows, requestRows, purchaseOrderRows] = await Promise.all([
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db.select().from(materials).orderBy(asc(materials.name)),
    db.select().from(warehouses).orderBy(asc(warehouses.name)),
    db.select().from(inventoryDefectAlerts).orderBy(desc(inventoryDefectAlerts.createdAt)),
    db.select().from(inventoryReturnClaims).orderBy(desc(inventoryReturnClaims.createdAt)),
    db.select().from(inventorySurplus).orderBy(desc(inventorySurplus.createdAt)),
    hydrateRequests(),
    hydratePurchaseOrders(),
  ]);

  const hydratedMaterials = await hydrateMaterialRows(materialRows);

  res.json({
    suppliers: supplierRows.map((row) => ({
      id: row.id,
      name: row.name,
      nit: row.nit ?? '',
      phone: row.phone,
      email: row.email ?? '',
      address: row.address ?? '',
      supplierType: row.supplierType ?? 'General',
      purchaseHistoryCount: Number(row.purchaseHistoryCount ?? 0),
      deliveryDelays: Number(row.deliveryDelays ?? 0),
      defectsRate: Number(row.defectsRate ?? 0),
      avgPriceCompetitiveness: Number(row.avgPriceCompetitiveness ?? 0),
      status: row.status,
    })),
    materials: hydratedMaterials,
    warehouses: warehouseRows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      location: row.location ?? '',
      status: row.status,
    })),
    requests: requestRows,
    defects: defectRows.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      supplierId: row.supplierId,
      defectType: row.defectType,
      affectedQuantity: Number(row.affectedQuantity ?? 0),
      status: row.status,
      supplierReportSent: row.supplierReportSent,
      createdAt: row.createdAt,
      notes: row.notes,
    })),
    claims: claimRows.map((row) => ({
      id: row.id,
      purchaseOrderRef: row.purchaseOrderRef,
      purchaseOrderId: row.purchaseOrderId,
      materialId: row.materialId,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt,
    })),
    surplus: surplusRows.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      quantity: Number(row.quantity ?? 0),
      origin: row.origin,
      classification: row.classification,
      reintegrated: row.reintegrated,
      createdAt: row.createdAt,
    })),
    purchaseOrders: purchaseOrderRows,
  });
});

router.post('/suppliers', validate(supplierSchema), async (req, res) => {
  const { name, nit, phone, email, address, supplierType } = req.body;

  const [created] = await db.insert(suppliers).values({
    id: randomUUID(),
    name: name.trim(),
    nit: nit.trim(),
    phone: phone.trim(),
    email: email?.trim() || null,
    address: address?.trim() || null,
    supplierType: supplierType.trim(),
    productsProvided: [supplierType.trim()],
    status: 'active',
  }).returning();

  res.status(201).json(created);
});

router.post('/materials', validate(materialSchema), async (req, res) => {
  const [existingBySku] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(eq(materials.sku, req.body.sku.trim()));

  if (existingBySku) {
    res.status(400).json({ error: 'El SKU ya existe.' });
    return;
  }

  const warehouse = await ensureWarehouseByName(req.body.warehouse);
  const initialStock = Math.max(0, toNumber(req.body.initialStock));
  const price = Math.max(0, toNumber(req.body.purchasePriceBs));
  const minStock = Math.max(0, toNumber(req.body.minStock));

  const [created] = await db.insert(materials).values({
    id: randomUUID(),
    name: req.body.name.trim(),
    category: req.body.category.trim(),
    supplierId: req.body.supplierId,
    sku: req.body.sku.trim(),
    unit: req.body.unit.trim(),
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    purchaseDate: req.body.purchaseDate,
    lastPurchaseDate: req.body.purchaseDate,
    unitPrice: String(price),
    stock: initialStock,
    stockPhysical: initialStock,
    stockReserved: 0,
    blockedByDefect: 0,
    minStock,
    imageUrl: req.body.imageUrl?.trim() || null,
    image: req.body.imageUrl?.trim() || null,
  }).returning();

  await db.insert(materialPriceHistory).values({
    id: randomUUID(),
    materialId: created.id,
    effectiveDate: req.body.purchaseDate,
    priceBs: String(price),
    exchangeRate: '6.96',
    notes: 'Registro inicial',
  });

  const [hydrated] = await hydrateMaterialRows([created]);
  res.status(201).json(hydrated);
});

router.put('/materials/:id', validate(materialUpdateSchema), async (req, res) => {
  const materialId = req.params.id as string;
  const [current] = await db.select().from(materials).where(eq(materials.id, materialId));

  if (!current) {
    res.status(404).json({ error: 'Material no encontrado.' });
    return;
  }

  const nextSku = req.body.sku?.trim();
  if (nextSku && nextSku !== current.sku) {
    const [existingBySku] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(eq(materials.sku, nextSku));
    if (existingBySku) {
      res.status(400).json({ error: 'El SKU ya existe.' });
      return;
    }
  }

  const warehouse = req.body.warehouse
    ? await ensureWarehouseByName(req.body.warehouse)
    : current.warehouseName
    ? await ensureWarehouseByName(current.warehouseName)
    : null;

  const [updated] = await db.update(materials).set({
    name: req.body.name?.trim() ?? current.name,
    category: req.body.category?.trim() ?? current.category,
    supplierId: req.body.supplierId ?? current.supplierId,
    sku: nextSku ?? current.sku,
    unit: req.body.unit?.trim() ?? current.unit,
    warehouseId: warehouse?.id ?? current.warehouseId,
    warehouseName: warehouse?.name ?? current.warehouseName,
    imageUrl: req.body.imageUrl?.trim() ?? current.imageUrl,
    image: req.body.imageUrl?.trim() ?? current.image,
    minStock: req.body.minStock !== undefined ? Math.max(0, toNumber(req.body.minStock)) : current.minStock,
    ...(req.body.purchasePriceBs !== undefined ? { unitPrice: String(Math.max(0, toNumber(req.body.purchasePriceBs))) } : {}),
    updatedAt: new Date(),
  }).where(eq(materials.id, materialId)).returning();

  if (req.body.purchasePriceBs !== undefined) {
    await db.insert(materialPriceHistory).values({
      id: randomUUID(),
      materialId: updated.id,
      effectiveDate: updated.purchaseDate ?? updated.lastPurchaseDate ?? new Date().toISOString().slice(0, 10),
      priceBs: String(Math.max(0, toNumber(req.body.purchasePriceBs))),
      exchangeRate: '6.96',
      notes: 'Actualización manual',
    });
  }

  const [hydrated] = await hydrateMaterialRows([updated]);
  res.json(hydrated);
});

router.delete('/materials/:id', async (req, res) => {
  const materialId = req.params.id as string;
  const [deleted] = await db.delete(materials).where(eq(materials.id, materialId)).returning();
  if (!deleted) {
    res.status(404).json({ error: 'Material no encontrado.' });
    return;
  }
  res.json({ success: true });
});

router.patch('/materials/:id/min-stock', validate(minStockSchema), async (req, res) => {
  const materialId = req.params.id as string;
  const [updated] = await db.update(materials).set({
    minStock: Math.max(0, toNumber(req.body.minStock)),
    updatedAt: new Date(),
  }).where(eq(materials.id, materialId)).returning();

  if (!updated) {
    res.status(404).json({ error: 'Material no encontrado.' });
    return;
  }

  const [hydrated] = await hydrateMaterialRows([updated]);
  res.json(hydrated);
});

router.post('/materials/:id/stock-adjustments', validate(stockAdjustmentSchema), async (req, res) => {
  const materialId = req.params.id as string;
  const [current] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!current) {
    res.status(404).json({ error: 'Material no encontrado.' });
    return;
  }

  const quantityToAdd = Math.max(0, toNumber(req.body.quantityToAdd));
  const newPriceBs = req.body.newPriceBs != null ? Math.max(0, toNumber(req.body.newPriceBs)) : null;

  const [updated] = await db.update(materials).set({
    stock: Number(current.stock ?? 0) + quantityToAdd,
    stockPhysical: Number(current.stockPhysical ?? current.stock ?? 0) + quantityToAdd,
    unitPrice: newPriceBs != null ? String(newPriceBs) : current.unitPrice,
    purchaseDate: new Date().toISOString().slice(0, 10),
    lastPurchaseDate: new Date().toISOString().slice(0, 10),
    updatedAt: new Date(),
  }).where(eq(materials.id, materialId)).returning();

  if (newPriceBs != null) {
    await db.insert(materialPriceHistory).values({
      id: randomUUID(),
      materialId,
      effectiveDate: new Date().toISOString().slice(0, 10),
      priceBs: String(newPriceBs),
      exchangeRate: '6.96',
      notes: 'Ingreso de stock',
    });
  }

  const [hydrated] = await hydrateMaterialRows([updated]);
  res.json(hydrated);
});

router.post('/defects', validate(defectSchema), async (req, res) => {
  const [material] = await db.select().from(materials).where(eq(materials.id, req.body.materialId));
  if (!material) {
    res.status(404).json({ error: 'Material no encontrado.' });
    return;
  }

  const quantity = Math.max(1, toNumber(req.body.affectedQuantity));

  const [created] = await db.insert(inventoryDefectAlerts).values({
    id: randomUUID(),
    materialId: material.id,
    supplierId: material.supplierId,
    defectType: req.body.defectType.trim(),
    affectedQuantity: quantity,
    status: 'nuevo',
    supplierReportSent: true,
    createdAt: new Date().toISOString().slice(0, 10),
    createdBy: req.body.createdBy?.trim() || null,
  }).returning();

  await db.update(materials).set({
    blockedByDefect: Number(material.blockedByDefect ?? 0) + quantity,
    updatedAt: new Date(),
  }).where(eq(materials.id, material.id));

  res.status(201).json(created);
});

router.patch('/defects/:id/advance', async (req, res) => {
  const defectId = req.params.id as string;
  const [current] = await db.select().from(inventoryDefectAlerts).where(eq(inventoryDefectAlerts.id, defectId));
  if (!current) {
    res.status(404).json({ error: 'Alerta no encontrada.' });
    return;
  }

  const nextStatus =
    current.status === 'nuevo'
      ? 'reportado'
      : current.status === 'reportado'
      ? 'en-gestion'
      : current.status === 'en-gestion'
      ? 'resuelto'
      : 'resuelto';

  const [updated] = await db.update(inventoryDefectAlerts).set({
    status: nextStatus,
  }).where(eq(inventoryDefectAlerts.id, defectId)).returning();

  res.json(updated);
});

router.post('/claims', validate(claimSchema), async (req, res) => {
  const [purchaseOrder] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.referenceCode, req.body.purchaseOrderRef.trim()));

  const [created] = await db.insert(inventoryReturnClaims).values({
    id: randomUUID(),
    purchaseOrderRef: req.body.purchaseOrderRef.trim(),
    purchaseOrderId: purchaseOrder?.id ?? null,
    materialId: req.body.materialId,
    reason: req.body.reason.trim(),
    status: 'abierto',
  }).returning();

  res.status(201).json(created);
});

router.patch('/claims/:id/advance', async (req, res) => {
  const claimId = req.params.id as string;
  const [current] = await db.select().from(inventoryReturnClaims).where(eq(inventoryReturnClaims.id, claimId));
  if (!current) {
    res.status(404).json({ error: 'Reclamo no encontrado.' });
    return;
  }

  const nextStatus =
    current.status === 'abierto'
      ? 'en-revision'
      : current.status === 'en-revision'
      ? 'resuelto'
      : 'resuelto';

  const [updated] = await db.update(inventoryReturnClaims).set({
    status: nextStatus,
    updatedAt: new Date(),
  }).where(eq(inventoryReturnClaims.id, claimId)).returning();

  res.json(updated);
});

router.post('/surplus', validate(surplusSchema), async (req, res) => {
  const [created] = await db.insert(inventorySurplus).values({
    id: randomUUID(),
    materialId: req.body.materialId,
    quantity: String(Math.max(0, toNumber(req.body.quantity))),
    origin: req.body.origin.trim(),
    classification: req.body.classification,
    reintegrated: false,
  }).returning();

  res.status(201).json(created);
});

router.patch('/surplus/:id/reintegrate', async (req, res) => {
  const surplusId = req.params.id as string;
  const [current] = await db.select().from(inventorySurplus).where(eq(inventorySurplus.id, surplusId));
  if (!current) {
    res.status(404).json({ error: 'Sobrante no encontrado.' });
    return;
  }
  if (current.classification !== 'reutilizable' || current.reintegrated) {
    res.status(400).json({ error: 'Este sobrante no se puede reintegrar.' });
    return;
  }

  const [material] = await db.select().from(materials).where(eq(materials.id, current.materialId));
  if (!material) {
    res.status(404).json({ error: 'Material no encontrado.' });
    return;
  }

  await db.update(materials).set({
    stock: Number(material.stock ?? 0) + toNumber(current.quantity),
    stockPhysical: Number(material.stockPhysical ?? material.stock ?? 0) + toNumber(current.quantity),
    updatedAt: new Date(),
  }).where(eq(materials.id, material.id));

  const [updated] = await db.update(inventorySurplus).set({
    reintegrated: true,
    updatedAt: new Date(),
  }).where(eq(inventorySurplus.id, surplusId)).returning();

  res.json(updated);
});

router.delete('/surplus/:id', async (req, res) => {
  const surplusId = req.params.id as string;
  const [deleted] = await db.delete(inventorySurplus).where(eq(inventorySurplus.id, surplusId)).returning();
  if (!deleted) {
    res.status(404).json({ error: 'Sobrante no encontrado.' });
    return;
  }
  res.json({ success: true });
});

export default router;
