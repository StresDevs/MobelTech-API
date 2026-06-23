import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { db } from '../db';
import { clients, contractors, measurements, notifications, prequotationLogs, prequotationUidCounters, prequotationVersions, prequotations, productionItems, productionItemPhases, productionOrders, quotations, quotationItems, users } from '../db/schema';
import { ensurePrequotationUidSchema } from '../db/ensure-prequotation-uid';
import { ensureProductionSchema } from '../db/ensure-production-schema';

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
  advanceAmount: z.union([z.number(), z.string()]).optional().nullable(),
});

const updatePrequotationSchema = createPrequotationSchema.partial().extend({
  versions: z.array(prequotationVersionSchema).optional(),
  logs: z.array(prequotationLogSchema).optional(),
});

const prequotationListQuerySchema = z.object({
  search: z.string().optional().default(''),
  status: z.enum(['all', 'draft', 'in-review', 'adjustment', 'confirmed', 'rejected']).optional().default('all'),
  billingRequested: z.enum(['all', 'true']).optional().default('all'),
});

async function hydratePrequotation(prequotationId: string) {
  const [prequotation] = await db.select().from(prequotations).where(eq(prequotations.id, prequotationId));
  if (!prequotation) return null;

  return hydratePrequotationRow(prequotation);
}

async function hydratePrequotationRow(prequotation: typeof prequotations.$inferSelect) {
  const versions = await db
    .select()
    .from(prequotationVersions)
    .where(eq(prequotationVersions.prequotationId, prequotation.id))
    .orderBy(desc(prequotationVersions.version));

  const logs = await db
    .select()
    .from(prequotationLogs)
    .where(eq(prequotationLogs.prequotationId, prequotation.id))
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

function sequenceToLetters(sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid prequotation UID sequence: ${sequence}`);
  }

  let n = sequence;
  let output = '';
  while (n > 0) {
    n -= 1;
    output = String.fromCharCode(65 + (n % 26)) + output;
    n = Math.floor(n / 26);
  }
  return output;
}

function getBusinessDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/La_Paz',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: lookup.day ?? '01',
    month: lookup.month ?? '01',
    year: lookup.year ?? '1970',
  };
}

function formatPrequotationUidDate(date: Date) {
  const { day, month, year } = getBusinessDateParts(date);
  return `${day}${month}${year}`;
}

function formatPrequotationCounterDate(date: Date) {
  const { day, month, year } = getBusinessDateParts(date);
  return `${year}-${month}-${day}`;
}

async function allocatePrequotationUid(referenceDate = new Date()) {
  const [counter] = await db
    .insert(prequotationUidCounters)
    .values({ uidDate: formatPrequotationCounterDate(referenceDate) })
    .onConflictDoUpdate({
      target: prequotationUidCounters.uidDate,
      set: {
        nextSequence: sql`${prequotationUidCounters.nextSequence} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ nextSequence: prequotationUidCounters.nextSequence });

  const sequence = counter?.nextSequence ?? 1;
  return {
    uid: `${formatPrequotationUidDate(referenceDate)}${sequenceToLetters(sequence)}`,
    uidAssignedAt: referenceDate,
  };
}

function summarizePrequotation(prequotation: typeof prequotations.$inferSelect) {
  return {
    ...prequotation,
    versions: [],
    logs: [],
  };
}

async function validateMeasurementAnchor({
  clientId,
  measurementId,
  prequotationId,
}: {
  clientId?: string;
  measurementId?: string | null;
  prequotationId?: string;
}) {
  if (!measurementId) return null;

  const [measurement] = await db
    .select({ id: measurements.id, clientId: measurements.clientId })
    .from(measurements)
    .where(eq(measurements.id, measurementId));

  if (!measurement) return 'Measurement not found for measurementId';
  if (clientId && measurement.clientId !== clientId) return 'Measurement does not belong to the selected client';

  const existingRows = await db
    .select({ id: prequotations.id })
    .from(prequotations)
    .where(eq(prequotations.measurementId, measurementId));

  const existing = existingRows.find((row) => row.id !== prequotationId);
  if (existing) return 'Measurement already has a linked prequotation';

  return null;
}

// GET /api/prequotations
router.get('/', async (req: Request, res: Response) => {
  await ensurePrequotationUidSchema();
  const parsed = prequotationListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid prequotation filters', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const search = parsed.data.search.trim();
  const filters = [
    parsed.data.status === 'all' ? undefined : eq(prequotations.status, parsed.data.status),
    parsed.data.billingRequested === 'true' ? eq(prequotations.billingRequested, true) : undefined,
    search
      ? or(
          ilike(prequotations.title, `%${search}%`),
          ilike(clients.name, `%${search}%`),
        )
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: prequotations.id,
      clientId: prequotations.clientId,
      measurementId: prequotations.measurementId,
      title: prequotations.title,
      status: prequotations.status,
      currentVersion: prequotations.currentVersion,
      createdBy: prequotations.createdBy,
      uid: prequotations.uid,
      uidAssignedAt: prequotations.uidAssignedAt,
      assignedContractorId: prequotations.assignedContractorId,
      startDate: prequotations.startDate,
      estimatedDeliveryDate: prequotations.estimatedDeliveryDate,
      notes: prequotations.notes,
      convertedToQuotationId: prequotations.convertedToQuotationId,
      billingRequested: prequotations.billingRequested,
      totalAmount: prequotations.totalAmount,
      advanceAmount: prequotations.advanceAmount,
      createdAt: prequotations.createdAt,
      updatedAt: prequotations.updatedAt,
    })
    .from(prequotations)
    .leftJoin(clients, eq(prequotations.clientId, clients.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(prequotations.updatedAt));

  res.json(rows.map(summarizePrequotation));
});

// GET /api/prequotations/:id
router.get('/:id', async (req: Request, res: Response) => {
  await ensurePrequotationUidSchema();
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
    await ensurePrequotationUidSchema();
    const { versions, logs, totalAmount, advanceAmount, clientId, measurementId, assignedContractorId, startDate, estimatedDeliveryDate, ...data } = req.body;

    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
    if (!client) {
      res.status(400).json({ error: 'Client not found for clientId' });
      return;
    }

    const measurementError = await validateMeasurementAnchor({ clientId, measurementId });
    if (measurementError) {
      res.status(400).json({ error: measurementError });
      return;
    }

    const shouldAssignUid = (data.status ?? 'draft') === 'in-review';
    const uidAssignment = shouldAssignUid ? await allocatePrequotationUid(new Date()) : null;

    const [created] = await db.insert(prequotations).values({
      clientId,
      measurementId: measurementId ?? null,
      assignedContractorId: assignedContractorId ?? null,
      startDate: startDate ?? null,
      estimatedDeliveryDate: estimatedDeliveryDate ?? null,
      ...data,
      uid: uidAssignment?.uid ?? null,
      uidAssignedAt: uidAssignment?.uidAssignedAt ?? null,
      totalAmount: totalAmount != null ? String(totalAmount) : null,
      advanceAmount: advanceAmount != null ? String(advanceAmount) : null,
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
  await ensurePrequotationUidSchema();
  const id = req.params.id as string;
  const { versions, logs, totalAmount, advanceAmount, clientId, measurementId, assignedContractorId, startDate, estimatedDeliveryDate, ...data } = req.body;

  const [current] = await db.select().from(prequotations).where(eq(prequotations.id, id));
  if (!current) {
    res.status(404).json({ error: 'Prequotation not found' });
    return;
  }

  const nextClientId = clientId ?? current.clientId;
  const nextMeasurementId = Object.prototype.hasOwnProperty.call(req.body, 'measurementId')
    ? measurementId
    : current.measurementId;

  const measurementError = await validateMeasurementAnchor({
    clientId: nextClientId,
    measurementId: nextMeasurementId,
    prequotationId: id,
  });
  if (measurementError) {
    res.status(400).json({ error: measurementError });
    return;
  }

  const nextStatus = data.status ?? current.status;
  const shouldAssignUid = !current.uid && nextStatus === 'in-review';
  const uidAssignment = shouldAssignUid ? await allocatePrequotationUid(new Date()) : null;

  const [updated] = await db
    .update(prequotations)
    .set({
      ...data,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body, 'measurementId') ? { measurementId: measurementId ?? null } : {}),
      assignedContractorId: assignedContractorId ?? undefined,
      startDate: startDate ?? undefined,
      estimatedDeliveryDate: estimatedDeliveryDate ?? undefined,
      ...(uidAssignment ? { uid: uidAssignment.uid, uidAssignedAt: uidAssignment.uidAssignedAt } : {}),
      ...(totalAmount != null ? { totalAmount: String(totalAmount) } : {}),
      ...(advanceAmount != null ? { advanceAmount: String(advanceAmount) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(prequotations.id, id))
    .returning();

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
    await ensurePrequotationUidSchema();
    await ensureProductionSchema();
    const id = req.params.id as string;
    const { assignedContractorId, startDate, estimatedDeliveryDate, advanceAmount } = req.body as {
    assignedContractorId?: string;
    startDate?: string;
    estimatedDeliveryDate?: string;
    advanceAmount?: string | number;
    };

    const [prequotation] = await db.select().from(prequotations).where(eq(prequotations.id, id));
    if (!prequotation) {
      res.status(404).json({ error: 'Prequotation not found' });
      return;
    }

    const parsedAdvanceAmount = Number(
      advanceAmount ?? prequotation.advanceAmount ?? 0,
    );
    if (!Number.isFinite(parsedAdvanceAmount) || parsedAdvanceAmount <= 0) {
      res.status(400).json({ error: 'advanceAmount is required to confirm and must be greater than zero' });
      return;
    }

    const contractorId = assignedContractorId ?? prequotation.assignedContractorId ?? null;
    const effectiveStartDate = startDate ?? (prequotation.startDate ? String(prequotation.startDate) : null);
    const effectiveEstimatedDeliveryDate = estimatedDeliveryDate ?? (prequotation.estimatedDeliveryDate ? String(prequotation.estimatedDeliveryDate) : null);

    const [contractorRow] = contractorId
      ? await db.select({
          id: contractors.id,
          name: contractors.name,
          userId: contractors.userId,
        }).from(contractors).where(eq(contractors.id, contractorId))
      : [null];
    if (contractorId && !contractorRow) {
      res.status(400).json({ error: 'assignedContractorId not found in contractors table' });
      return;
    }

    const provisionedCredentials = contractorRow && !contractorRow.userId
      ? await ensureContractorAccess(contractorRow.id, contractorRow.name)
      : null;

    const recipientUserId = contractorRow?.userId ?? provisionedCredentials?.userId ?? null;

    const [updatedQuotation] = await db.insert(quotations).values({
      clientId: prequotation.clientId,
      status: 'draft',
      totalAmount: prequotation.totalAmount != null ? String(prequotation.totalAmount) : '0',
      advanceAmount: String(parsedAdvanceAmount),
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
      assignedContractorId: contractorId ?? prequotation.assignedContractorId ?? null,
      startDate: effectiveStartDate ?? prequotation.startDate ?? null,
      estimatedDeliveryDate: effectiveEstimatedDeliveryDate ?? prequotation.estimatedDeliveryDate ?? null,
      advanceAmount: String(parsedAdvanceAmount),
      convertedToQuotationId: updatedQuotation.id,
      updatedAt: new Date(),
    }).where(eq(prequotations.id, id)).returning();

    const shouldCreateProductionOrder = Boolean(contractorId && effectiveStartDate && effectiveEstimatedDeliveryDate);
    const [productionOrder] = shouldCreateProductionOrder
      ? await db.insert(productionOrders).values({
          projectId: null,
          quotationId: updatedQuotation.id,
          assignedContractorId: contractorId,
          status: 'pending',
          startDate: effectiveStartDate as string,
          estimatedDeliveryDate: effectiveEstimatedDeliveryDate as string,
        }).returning()
      : [null];

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

    if (recipientUserId && productionOrder) {
      await db.insert(notifications).values({
        id: randomUUID(),
        recipientUserId,
        message: `Tienes un trabajo asignado: ${prequotation.title}`,
        relatedJobId: productionOrder.id,
      });
    }

    res.json({
      prequotation: await hydratePrequotation(id),
      contractorCredentials: provisionedCredentials
        ? {
            username: provisionedCredentials.username,
            password: provisionedCredentials.password,
          }
        : null,
      productionOrderId: productionOrder?.id ?? null,
    });
  } catch (err) {
    console.error('❌ Error confirming prequotation:', err);
    res.status(500).json({ error: 'Failed to confirm prequotation', message: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// DELETE /api/prequotations/:id
router.delete('/:id', async (req: Request, res: Response) => {
  await ensurePrequotationUidSchema();
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
  await ensurePrequotationUidSchema();
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

function slugifyUsername(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24) || 'contratista';
}

function generatePassword() {
  return `mt${Math.random().toString(36).slice(2, 6)}${Date.now().toString().slice(-4)}`;
}

async function generateAvailableUsername(baseValue: string) {
  const base = slugifyUsername(baseValue);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate));

    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}.${suffix}`;
  }
}

async function ensureContractorAccess(contractorId: string, contractorName: string) {
  const username = await generateAvailableUsername(contractorName);
  const password = generatePassword();
  const email = `${username}@mobeltech.local`;

  const [user] = await db.insert(users).values({
    id: randomUUID(),
    name: contractorName,
    username,
    email,
    passwordHash: password,
    role: 'contractor',
  }).returning();

  await db
    .update(contractors)
    .set({
      userId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(contractors.id, contractorId));

  return {
    userId: user.id,
    username,
    password,
  };
}
