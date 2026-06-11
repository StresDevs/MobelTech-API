import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { db } from '../db';
import { prequotationLogs, prequotationVersions, prequotations } from '../db/schema';

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
  const prequotation = await hydratePrequotation(req.params.id);
  if (!prequotation) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }
  res.json(prequotation);
});

// POST /api/prequotations
router.post('/', validate(createPrequotationSchema), async (req: Request, res: Response) => {
  const { versions, logs, totalAmount, ...data } = req.body;

  const [created] = await db.insert(prequotations).values({
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
});

// PUT /api/prequotations/:id
router.put('/:id', validate(updatePrequotationSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { versions, logs, totalAmount, ...data } = req.body;

  const [updated] = await db
    .update(prequotations)
    .set({
      ...data,
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
    .where(eq(prequotations.id, req.params.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }

  res.json(await hydratePrequotation(updated.id));
});

export default router;
