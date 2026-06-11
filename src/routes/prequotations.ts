import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { db } from '../db';
import { clients, contractors, prequotationLogs, prequotationVersions, prequotations, productionItems, productionItemPhases, productionOrders, quotations, quotationItems } from '../db/schema';

const router = Router();

const prequotationVersionSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(['pdf', 'excel']),
  fileSize: z.string().min(1),
  uploadedBy: z.string().min(1),
  uploadedAt: z.coerce.date().optional(),
  notes: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.string()).optional().nullable(),
});

const prequotationLogSchema = z.object({
  action: z.enum([
    'created',
    'file_uploaded',
    'file_downloaded',
    'status_changed',
    'comment_added',
    'converted_to_quotation',
  ]),
  performedBy: z.string().min(1),
  performedAt: z.coerce.date().optional(),
  description: z.string().min(1),
  metadata: z.record(z.string(), z.string()).optional().nullable(),
});

const createPrequotationSchema = z.object({
  clientId: z.string().uuid(),
  measurementId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(255),
  assignedContractorId: z.string().uuid().optional().nullable(),
  startDate: z.string().optional().nullable(),
  estimatedDeliveryDate: z.string().optional().nullable(),
  status: z.enum(['draft', 'in-review', 'adjustment', 'confirmed', 'rejected']).optional(),
  currentVersion: z.number().int().min(1).optional(),
  versions: z.array(prequotationVersionSchema).min(1),
  logs: z.array(prequotationLogSchema).default([]),
  createdBy: z.string().min(1),
  notes: z.string().optional().nullable(),
  convertedToQuotationId: z.string().uuid().optional().nullable(),
  billingRequested: z.boolean().optional(),
  totalAmount: z.union([z.number(), z.string()]).optional().nullable(),
});

const updatePrequotationSchema = createPrequotationSchema.partial().extend({
  versions: z.array(prequotationVersionSchema).optional(),
  logs: z.array(prequotationLogSchema).optional(),
});

async function hydratePrequotation(prequotationId: string) {
  const [prequotation] = await db.select().from(prequotations).where(eq(prequotations.id, prequotationId));
  if (!prequotation) return null;

  const versions = await db
    .select()
    .from(prequotationVersions)
    .where(eq(prequotationVersions.prequotationId, prequotationId))
    .orderBy(desc(prequotationVersions.version));

  const logs = await db
    .select()
    .from(prequotationLogs)
    .where(eq(prequotationLogs.prequotationId, prequotationId))
    .orderBy(desc(prequotationLogs.performedAt));

  return {
    ...prequotation,
    versions: versions.map((version) => ({
      ...version,
      uploadedAt: version.uploadedAt,
    })),
    logs: logs.map((log) => ({
      ...log,
      performedAt: log.performedAt,
    })),
  };
}

// GET /api/prequotations
router.get('/', async (_req: Request, res: Response) => {
  const rows = await db.select().from(prequotations).orderBy(desc(prequotations.updatedAt));
  const hydrated = await Promise.all(rows.map((row) => hydratePrequotation(row.id)));
  res.json(hydrated.filter(Boolean));
});

// GET /api/prequotations/:id
router.get('/:id', async (req: Request, res: Response) => {
  const prequotation = await hydratePrequotation(req.params.id as string);
  if (!prequotation) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }
  res.json(prequotation);
});

// POST /api/prequotations
router.post('/', validate(createPrequotationSchema), async (req: Request, res: Response) => {
  try {
    const { versions, logs, totalAmount, clientId, assignedContractorId, startDate, estimatedDeliveryDate, ...data } = req.body;

    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
    if (!client) {
      res.status(400).json({ error: 'Client not found for clientId' });
      return;
    }

    const [created] = await db.insert(prequotations).values({
      clientId,
      assignedContractorId: assignedContractorId ?? null,
      startDate: startDate ?? null,
      estimatedDeliveryDate: estimatedDeliveryDate ?? null,
      ...data,
      totalAmount: totalAmount != null ? String(totalAmount) : null,
    }).returning();

    await db.insert(prequotationVersions).values(
      versions.map((version: any, index: number) => ({
        prequotationId: created.id,
        version: version.version ?? index + 1,
        fileName: version.fileName,
        fileType: version.fileType,
        fileSize: version.fileSize,
        uploadedBy: version.uploadedBy,
        uploadedAt: version.uploadedAt ?? new Date(),
        notes: version.notes ?? null,
        fileUrl: version.fileUrl ?? null,
        metadata: version.metadata ?? null,
      })),
    );

    if (logs.length > 0) {
      await db.insert(prequotationLogs).values(
        logs.map((log: any) => ({
          prequotationId: created.id,
          action: log.action,
          performedBy: log.performedBy,
          performedAt: log.performedAt ?? new Date(),
          description: log.description,
          metadata: log.metadata ?? null,
        })),
      );
    }

    const hydrated = await hydratePrequotation(created.id);
    res.status(201).json(hydrated);
  } catch (err) {
    console.error('❌ Error creating prequotation:', err);
    res.status(500).json({
      error: 'Failed to create prequotation',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// PUT /api/prequotations/:id
router.put('/:id', validate(updatePrequotationSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { versions, logs, totalAmount, assignedContractorId, startDate, estimatedDeliveryDate, ...data } = req.body;

  const [updated] = await db
    .update(prequotations)
    .set({
      ...data,
      assignedContractorId: assignedContractorId ?? undefined,
      startDate: startDate ?? undefined,
      estimatedDeliveryDate: estimatedDeliveryDate ?? undefined,
      ...(totalAmount != null ? { totalAmount: String(totalAmount) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(prequotations.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }

  if (Array.isArray(versions)) {
    await db.delete(prequotationVersions).where(eq(prequotationVersions.prequotationId, id));
    await db.insert(prequotationVersions).values(
      versions.map((version: any, index: number) => ({
        prequotationId: id,
        version: version.version ?? index + 1,
        fileName: version.fileName,
        fileType: version.fileType,
        fileSize: version.fileSize,
        uploadedBy: version.uploadedBy,
        uploadedAt: version.uploadedAt ?? new Date(),
        notes: version.notes ?? null,
        fileUrl: version.fileUrl ?? null,
        metadata: version.metadata ?? null,
      })),
    );
  }

  if (Array.isArray(logs)) {
    await db.delete(prequotationLogs).where(eq(prequotationLogs.prequotationId, id));
    await db.insert(prequotationLogs).values(
      logs.map((log: any) => ({
        prequotationId: id,
        action: log.action,
        performedBy: log.performedBy,
        performedAt: log.performedAt ?? new Date(),
        description: log.description,
        metadata: log.metadata ?? null,
      })),
    );
  }

  const hydrated = await hydratePrequotation(id);
  res.json(hydrated);
});

router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { assignedContractorId, startDate, estimatedDeliveryDate } = req.body as {
    assignedContractorId?: string;
    startDate?: string;
    estimatedDeliveryDate?: string;
    };

    const [prequotation] = await db.select().from(prequotations).where(eq(prequotations.id, id));
    if (!prequotation) {
      res.status(404).json({ error: 'Prequotation not found' });
      return;
    }

    const contractorId = assignedContractorId ?? prequotation.assignedContractorId ?? null;
    const effectiveStartDate = startDate ?? (prequotation.startDate ? String(prequotation.startDate) : null);
    const effectiveEstimatedDeliveryDate = estimatedDeliveryDate ?? (prequotation.estimatedDeliveryDate ? String(prequotation.estimatedDeliveryDate) : null);

    if (!contractorId) {
      res.status(400).json({ error: 'assignedContractorId is required to confirm' });
      return;
    }
    const [contractorRow] = await db.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, contractorId));
    if (!contractorRow) {
      res.status(400).json({ error: 'assignedContractorId not found in contractors table' });
      return;
    }
    if (!effectiveStartDate || !effectiveEstimatedDeliveryDate) {
      res.status(400).json({ error: 'startDate and estimatedDeliveryDate are required to confirm' });
      return;
    }

    const [updatedQuotation] = await db.insert(quotations).values({
      clientId: prequotation.clientId,
      status: 'draft',
      totalAmount: prequotation.totalAmount != null ? String(prequotation.totalAmount) : '0',
      notes: prequotation.notes ?? null,
    }).returning();

    await db.insert(quotationItems).values({
      quotationId: updatedQuotation.id,
      description: prequotation.title,
      quantity: 1,
      unitPrice: prequotation.totalAmount != null ? String(prequotation.totalAmount) : '0',
      dimensions: null,
      notes: prequotation.notes ?? null,
    });

    const [updated] = await db.update(prequotations).set({
      status: 'confirmed',
      assignedContractorId: contractorId,
      startDate: effectiveStartDate,
      estimatedDeliveryDate: effectiveEstimatedDeliveryDate,
      convertedToQuotationId: updatedQuotation.id,
      updatedAt: new Date(),
    }).where(eq(prequotations.id, id)).returning();

    const [productionOrder] = await db.insert(productionOrders).values({
      projectId: null,
      quotationId: updatedQuotation.id,
      assignedContractorId: contractorId,
      status: 'pending',
      startDate: effectiveStartDate,
      estimatedDeliveryDate: effectiveEstimatedDeliveryDate,
    }).returning();

    if (productionOrder) {
    const [productionItem] = await db.insert(productionItems).values({
      productionOrderId: productionOrder.id,
      description: prequotation.title,
      quantity: 1,
      progress: 0,
    }).returning();

    await db.insert(productionItemPhases).values([
      { productionItemId: productionItem.id, phase: 'cortado', completed: 'false' },
      { productionItemId: productionItem.id, phase: 'canteado', completed: 'false' },
      { productionItemId: productionItem.id, phase: 'ensamblado', completed: 'false' },
      { productionItemId: productionItem.id, phase: 'instalacion', completed: 'false' },
      { productionItemId: productionItem.id, phase: 'entregado', completed: 'false' },
    ]);
    }

    res.json(await hydratePrequotation(id));
  } catch (err) {
    console.error('❌ Error confirming prequotation:', err);
    res.status(500).json({ error: 'Failed to confirm prequotation', message: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// DELETE /api/prequotations/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [deleted] = await db.delete(prequotations).where(eq(prequotations.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }
  res.json({ message: 'Prequotation deleted' });
});

// POST /api/prequotations/:id/convert
router.post('/:id/convert', async (req: Request, res: Response) => {
  const { quotationId } = req.body as { quotationId?: string };
  if (!quotationId) {
    res.status(400).json({ error: 'quotationId is required' });
    return;
  }

  const [updated] = await db
    .update(prequotations)
    .set({
      status: 'confirmed',
      convertedToQuotationId: quotationId,
      updatedAt: new Date(),
    })
    .where(eq(prequotations.id, req.params.id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }

  res.json(await hydratePrequotation(updated.id));
});

export default router;
