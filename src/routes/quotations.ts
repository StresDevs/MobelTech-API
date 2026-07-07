import { Router, Request, Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  clients,
  contractors,
  furnitureFileLogs,
  furnitureFiles,
  notifications,
  projectEnvironments,
  projects,
  prequotations,
  productionOrders,
  quotationAuditLogs,
  quotationItems,
  quotations,
  users,
} from '../db/schema';
import { validate } from '../middleware/validate';
import { randomUUID } from 'crypto';
import { ensureQuotationWorkflowSchema } from '../db/ensure-quotation-workflow';
import { ensureFurnitureFilesSchema } from '../db/ensure-furniture-files';

const router = Router();

const quotationItemSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.union([z.number(), z.string()]),
  dimensions: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateQuotationSchema = z.object({
  status: z.enum(['draft', 'adjustment', 'approved', 'rejected']).optional(),
  totalAmount: z.union([z.number(), z.string()]).optional(),
  advanceAmount: z.union([z.number(), z.string()]).optional(),
  notes: z.string().optional().nullable(),
  items: z.array(quotationItemSchema).optional(),
  adjustmentComment: z.string().trim().max(1000).optional(),
  changedBy: z.string().trim().min(1).max(255).optional(),
});

const optionalNullableTextSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().optional().nullable());

const numericInputSchema = z.preprocess((value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return Number.NaN;
    return Number(normalized);
  }
  return value;
}, z.number().finite().min(0));

const dateInputSchema = z.preprocess((value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}, z.string().min(1).refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: 'Invalid date',
}));

const nullableUuidSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(trimmed) ? trimmed : null;
}, z.string().uuid().optional().nullable());

const quotationEnvironmentSchema = z.object({
  ambience: z.string().min(1).max(160),
  description: optionalNullableTextSchema,
  sketchupFileName: optionalNullableTextSchema,
  sketchupFileUrl: optionalNullableTextSchema,
  sketchupFileSize: optionalNullableTextSchema,
  sketchupFileData: optionalNullableTextSchema,
  uploadedBy: optionalNullableTextSchema,
  price: numericInputSchema,
  clientPrice: numericInputSchema.optional(),
  estimatedStartDate: dateInputSchema,
  estimatedEndDate: dateInputSchema,
  assignedContractorId: nullableUuidSchema,
});

const createQuotationEnvironmentProjectsSchema = z.object({
  projects: z.array(quotationEnvironmentSchema).min(1),
});

const updateQuotationEnvironmentProjectSchema = quotationEnvironmentSchema.partial().extend({
  modificationNote: z.string().trim().min(1, 'Modification note is required').max(1000),
});

type QuotationRow = typeof quotations.$inferSelect;

async function hydrateQuotationRows(rows: Array<QuotationRow & { clientName?: string | null }>) {
  if (rows.length === 0) return [];

  const quotationIds = rows.map((row) => row.id);

  const [itemRows, linkedPrequotations, productionOrderRows, environmentRows, auditRows] = await Promise.all([
    db
      .select()
      .from(quotationItems)
      .where(inArray(quotationItems.quotationId, quotationIds)),
    db
      .select({
        id: prequotations.id,
        title: prequotations.title,
        uid: prequotations.uid,
        convertedToQuotationId: prequotations.convertedToQuotationId,
      })
      .from(prequotations)
      .where(inArray(prequotations.convertedToQuotationId, quotationIds)),
    db
      .select({
        quotationId: productionOrders.quotationId,
        assignedContractorId: productionOrders.assignedContractorId,
      })
      .from(productionOrders)
      .where(inArray(productionOrders.quotationId, quotationIds)),
    db
      .select({
        id: projectEnvironments.id,
        quotationId: projectEnvironments.quotationId,
        projectId: projectEnvironments.projectId,
        assignedContractorId: projectEnvironments.assignedContractorId,
        ambience: projectEnvironments.ambience,
        description: projectEnvironments.description,
        sketchupFileName: projectEnvironments.sketchupFileName,
        sketchupFileUrl: projectEnvironments.sketchupFileUrl,
        sketchupFileSize: projectEnvironments.sketchupFileSize,
        price: projectEnvironments.price,
        clientPrice: projectEnvironments.clientPrice,
        estimatedStartDate: projectEnvironments.estimatedStartDate,
        estimatedEndDate: projectEnvironments.estimatedEndDate,
        createdAt: projectEnvironments.createdAt,
        updatedAt: projectEnvironments.updatedAt,
      })
      .from(projectEnvironments)
      .where(inArray(projectEnvironments.quotationId, quotationIds)),
    db
      .select()
      .from(quotationAuditLogs)
      .where(inArray(quotationAuditLogs.quotationId, quotationIds))
      .orderBy(desc(quotationAuditLogs.changedAt)),
  ]);

  const contractorIds = Array.from(
    new Set(
      [...productionOrderRows, ...environmentRows]
        .map((row) => row.assignedContractorId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const contractorRows = contractorIds.length > 0
    ? await db
        .select({
          id: contractors.id,
          name: contractors.name,
          phone: contractors.phone,
          email: contractors.email,
          specialization: contractors.specialization,
          status: contractors.status,
        })
        .from(contractors)
        .where(inArray(contractors.id, contractorIds))
    : [];

  const itemsByQuotationId = new Map<string, typeof itemRows>();
  itemRows.forEach((item) => {
    const current = itemsByQuotationId.get(item.quotationId) ?? [];
    current.push(item);
    itemsByQuotationId.set(item.quotationId, current);
  });

  const prequotationByQuotationId = new Map(
    linkedPrequotations
      .filter((row): row is typeof row & { convertedToQuotationId: string } => Boolean(row.convertedToQuotationId))
      .map((row) => [row.convertedToQuotationId, row]),
  );

  const contractorsById = new Map(contractorRows.map((row) => [row.id, row]));
  const contractorIdsByQuotationId = new Map<string, string[]>();
  productionOrderRows.forEach((row) => {
    if (!row.quotationId || !row.assignedContractorId) return;
    const current = contractorIdsByQuotationId.get(row.quotationId) ?? [];
    if (!current.includes(row.assignedContractorId)) current.push(row.assignedContractorId);
    contractorIdsByQuotationId.set(row.quotationId, current);
  });

  const environmentsByQuotationId = new Map<string, typeof environmentRows>();
  environmentRows.forEach((row) => {
    const current = environmentsByQuotationId.get(row.quotationId) ?? [];
    current.push(row);
    environmentsByQuotationId.set(row.quotationId, current);
  });

  const auditLogsByQuotationId = new Map<string, typeof auditRows>();
  auditRows.forEach((row) => {
    const current = auditLogsByQuotationId.get(row.quotationId) ?? [];
    current.push(row);
    auditLogsByQuotationId.set(row.quotationId, current);
  });

  return rows.map((row) => {
    const quotationItemsForRow = (itemsByQuotationId.get(row.id) ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice ?? 0),
      dimensions: item.dimensions ?? '',
      notes: item.notes ?? undefined,
    }));

    const assignedContractors = (contractorIdsByQuotationId.get(row.id) ?? [])
      .map((id) => contractorsById.get(id))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    const linkedPrequotation = prequotationByQuotationId.get(row.id);
    const environmentProjects = (environmentsByQuotationId.get(row.id) ?? []).map((environment) => ({
      id: environment.id,
      projectId: environment.projectId,
      assignedContractorId: environment.assignedContractorId,
      ambience: environment.ambience,
      description: environment.description ?? null,
      sketchupFileName: environment.sketchupFileName ?? null,
      sketchupFileUrl: environment.sketchupFileUrl ?? null,
      sketchupFileSize: environment.sketchupFileSize ?? null,
      price: Number(environment.price ?? 0),
      clientPrice: Number(environment.clientPrice ?? environment.price ?? 0),
      estimatedStartDate: environment.estimatedStartDate,
      estimatedEndDate: environment.estimatedEndDate,
      contractorName: environment.assignedContractorId
        ? contractorsById.get(environment.assignedContractorId)?.name ?? null
        : null,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    }));

    return {
      id: row.id,
      uid: row.uid,
      clientId: row.clientId,
      projectId: row.projectId,
      status: row.status,
      totalAmount: Number(row.totalAmount ?? 0),
      advanceAmount: Number(row.advanceAmount ?? 0),
      notes: row.notes ?? undefined,
      createdDate: row.createdAt,
      updatedAt: row.updatedAt,
      items: quotationItemsForRow,
      auditLogs: (auditLogsByQuotationId.get(row.id) ?? []).map((audit) => ({
        id: audit.id,
        field: audit.field,
        previousValue: audit.previousValue,
        nextValue: audit.nextValue,
        comment: audit.comment ?? null,
        changedBy: audit.changedBy,
        changedAt: audit.changedAt,
      })),
      clientName: row.clientName ?? null,
      assignedContractors,
      environmentProjects,
      prequotation: linkedPrequotation
        ? {
            id: linkedPrequotation.id,
            title: linkedPrequotation.title,
            uid: linkedPrequotation.uid,
          }
        : null,
    };
  });
}

async function getHydratedQuotationById(id: string) {
  await ensureQuotationWorkflowSchema();
  await ensureFurnitureFilesSchema();
  const rows = await db
    .select({
      id: quotations.id,
      uid: quotations.uid,
      clientId: quotations.clientId,
      projectId: quotations.projectId,
      status: quotations.status,
      totalAmount: quotations.totalAmount,
      advanceAmount: quotations.advanceAmount,
      notes: quotations.notes,
      createdAt: quotations.createdAt,
      updatedAt: quotations.updatedAt,
      clientName: clients.name,
    })
    .from(quotations)
    .leftJoin(clients, eq(quotations.clientId, clients.id))
    .where(eq(quotations.id, id));

  const hydrated = await hydrateQuotationRows(rows);
  return hydrated[0] ?? null;
}

async function getEnvironmentClientPriceTotal(quotationId: string, overrides?: { environmentId?: string; clientPrice?: number }) {
  const rows = await db
    .select({
      id: projectEnvironments.id,
      price: projectEnvironments.price,
      clientPrice: projectEnvironments.clientPrice,
    })
    .from(projectEnvironments)
    .where(eq(projectEnvironments.quotationId, quotationId));

  return rows.reduce((sum, row) => {
    if (overrides?.environmentId && row.id === overrides.environmentId) {
      return sum + (overrides.clientPrice ?? Number(row.clientPrice ?? row.price ?? 0));
    }

    return sum + Number(row.clientPrice ?? row.price ?? 0);
  }, 0);
}

function getQuotationLimit(quotation: typeof quotations.$inferSelect) {
  return Number(quotation.totalAmount ?? 0);
}

function rejectEnvironmentBudgetOverflow(res: Response, total: number, limit: number) {
  res.status(400).json({
    error: `La suma de ambientes (${total.toFixed(2)} Bs) excede el monto cotizado (${limit.toFixed(2)} Bs).`,
    total,
    limit,
    exceededBy: total - limit,
  });
}

router.get('/', async (_req: Request, res: Response) => {
  await ensureQuotationWorkflowSchema();
  const rows = await db
    .select({
      id: quotations.id,
      uid: quotations.uid,
      clientId: quotations.clientId,
      projectId: quotations.projectId,
      status: quotations.status,
      totalAmount: quotations.totalAmount,
      advanceAmount: quotations.advanceAmount,
      notes: quotations.notes,
      createdAt: quotations.createdAt,
      updatedAt: quotations.updatedAt,
      clientName: clients.name,
    })
    .from(quotations)
    .leftJoin(clients, eq(quotations.clientId, clients.id))
    .orderBy(desc(quotations.createdAt));

  res.json(await hydrateQuotationRows(rows));
});

router.get('/:id', async (req: Request, res: Response) => {
  const quotation = await getHydratedQuotationById(req.params.id as string);
  if (!quotation) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  res.json(quotation);
});

router.put('/:id', validate(updateQuotationSchema), async (req: Request, res: Response) => {
  await ensureQuotationWorkflowSchema();
  const id = req.params.id as string;
  const { items, totalAmount, advanceAmount, adjustmentComment, changedBy, ...data } = req.body;

  const [current] = await db.select().from(quotations).where(eq(quotations.id, id));
  if (!current) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  const previousTotal = Number(current.totalAmount ?? 0);
  const nextTotal = totalAmount !== undefined ? Number(totalAmount) : previousTotal;
  if (totalAmount !== undefined && (!Number.isFinite(nextTotal) || nextTotal < 0)) {
    res.status(400).json({ error: 'totalAmount must be a valid amount greater than or equal to zero' });
    return;
  }

  if (totalAmount !== undefined) {
    const environmentTotal = await getEnvironmentClientPriceTotal(id);
    if (nextTotal < environmentTotal) {
      res.status(400).json({
        error: `El monto cotizado no puede ser menor a lo ya asignado a ambientes (${environmentTotal.toFixed(2)} Bs).`,
        total: nextTotal,
        environmentTotal,
      });
      return;
    }
  }

  await db
    .update(quotations)
    .set({
      ...data,
      ...(totalAmount !== undefined ? { totalAmount: String(totalAmount) } : {}),
      ...(advanceAmount !== undefined ? { advanceAmount: String(advanceAmount) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(quotations.id, id));

  if (Array.isArray(items)) {
    await db.delete(quotationItems).where(eq(quotationItems.quotationId, id));
    if (items.length > 0) {
      await db.insert(quotationItems).values(
        items.map((item) => ({
          quotationId: id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          dimensions: item.dimensions ?? null,
          notes: item.notes ?? null,
        })),
      );
    }
  }

  if (totalAmount !== undefined && previousTotal !== nextTotal) {
    const comment = typeof adjustmentComment === 'string' && adjustmentComment.trim()
      ? adjustmentComment.trim()
      : null;

    await db.insert(quotationAuditLogs).values({
      quotationId: id,
      field: 'totalAmount',
      previousValue: String(previousTotal),
      nextValue: String(nextTotal),
      comment: comment ?? null,
      changedBy: typeof changedBy === 'string' && changedBy.trim() ? changedBy.trim() : 'Sistema',
    });

    if (comment) {
      const existingNotes = typeof data.notes === 'string' ? data.notes.trim() : current.notes?.trim();
      const noteLine = `Comentario de reajuste: ${comment}`;
      await db
        .update(quotations)
        .set({
          notes: existingNotes ? `${existingNotes}\n\n${noteLine}` : noteLine,
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, id));
    }
  }

  res.json(await getHydratedQuotationById(id));
});

router.post('/:id/environment-projects', validate(createQuotationEnvironmentProjectsSchema), async (req: Request, res: Response) => {
  await ensureQuotationWorkflowSchema();
  const quotationId = req.params.id as string;
  const [quotation] = await db.select().from(quotations).where(eq(quotations.id, quotationId));

  if (!quotation) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
  }

  const payloadProjects = req.body.projects as Array<z.infer<typeof quotationEnvironmentSchema>>;
  const contractorIds = Array.from(
    new Set(
      payloadProjects
        .map((entry) => entry.assignedContractorId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const contractorRows = contractorIds.length > 0
    ? await db
        .select({
          id: contractors.id,
          name: contractors.name,
          userId: users.id,
        })
        .from(contractors)
        .leftJoin(users, eq(contractors.userId, users.id))
        .where(inArray(contractors.id, contractorIds))
    : [];

  const contractorsById = new Map(contractorRows.map((row) => [row.id, row]));
  if (contractorIds.some((contractorId) => !contractorsById.has(contractorId))) {
    res.status(400).json({ error: 'One or more assigned contractors were not found' });
    return;
  }

  for (const entry of payloadProjects) {
    const startTime = new Date(entry.estimatedStartDate).getTime();
    const endTime = new Date(entry.estimatedEndDate).getTime();
    if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
      res.status(400).json({ error: 'Each environment project must have a valid estimated date range' });
      return;
    }
  }

  const currentEnvironmentTotal = await getEnvironmentClientPriceTotal(quotationId);
  const newEnvironmentTotal = payloadProjects.reduce((sum, entry) => sum + Number(entry.clientPrice ?? entry.price ?? 0), 0);
  const quotationLimit = getQuotationLimit(quotation);
  if (currentEnvironmentTotal + newEnvironmentTotal > quotationLimit) {
    rejectEnvironmentBudgetOverflow(res, currentEnvironmentTotal + newEnvironmentTotal, quotationLimit);
    return;
  }

  const preparedProjects = payloadProjects.map((entry) => ({
    entry,
    clientPrice: entry.clientPrice ?? entry.price,
    projectId: randomUUID(),
    environmentId: randomUUID(),
    productionOrderId: entry.assignedContractorId ? randomUUID() : null,
  }));

  await db.insert(projects).values(preparedProjects.map(({ entry, clientPrice, projectId }) => ({
    id: projectId,
    name: entry.ambience.trim(),
    clientId: quotation.clientId,
    status: 'production' as const,
    startDate: entry.estimatedStartDate,
    estimatedDeliveryDate: entry.estimatedEndDate,
    budget: String(clientPrice),
    totalRevenue: String(clientPrice),
  })));

  await db.insert(projectEnvironments).values(preparedProjects.map(({ entry, clientPrice, projectId, environmentId }) => ({
    id: environmentId,
    quotationId,
    projectId,
    assignedContractorId: entry.assignedContractorId ?? null,
    ambience: entry.ambience.trim(),
    description: entry.description?.trim() || null,
    sketchupFileName: entry.sketchupFileName?.trim() || null,
    sketchupFileUrl: entry.sketchupFileUrl?.trim() || null,
    sketchupFileSize: entry.sketchupFileSize?.trim() || null,
    price: String(clientPrice),
    clientPrice: String(clientPrice),
    estimatedStartDate: entry.estimatedStartDate,
    estimatedEndDate: entry.estimatedEndDate,
  })));

  const furnitureFileRows = preparedProjects
    .filter(({ entry }) => Boolean(entry.sketchupFileName && entry.sketchupFileData))
    .map(({ entry, environmentId }) => ({
      id: randomUUID(),
      quotationId,
      projectEnvironmentId: environmentId,
      clientId: quotation.clientId,
      assignedContractorId: entry.assignedContractorId ?? null,
      version: 1,
      fileName: entry.sketchupFileName?.trim() ?? '',
      fileSize: entry.sketchupFileSize?.trim() || null,
      mimeType: 'application/octet-stream',
      fileData: entry.sketchupFileData ?? '',
      uploadedBy: entry.uploadedBy?.trim() || 'Usuario',
      notes: entry.ambience.trim(),
    }));

  if (furnitureFileRows.length > 0) {
    await db.insert(furnitureFiles).values(furnitureFileRows);
    await db.insert(furnitureFileLogs).values(furnitureFileRows.map((file) => ({
      furnitureFileId: file.id,
      action: 'file_uploaded' as const,
      performedBy: file.uploadedBy,
      description: `Archivo SketchUp inicial subido: ${file.fileName} (v1)`,
    })));
  }

  const productionOrderRows = preparedProjects
    .filter(({ entry, productionOrderId }) => Boolean(entry.assignedContractorId && productionOrderId))
    .map(({ entry, projectId, productionOrderId }) => ({
      id: productionOrderId as string,
      projectId,
      quotationId,
      assignedContractorId: entry.assignedContractorId as string,
      status: 'pending' as const,
      startDate: entry.estimatedStartDate,
      estimatedDeliveryDate: entry.estimatedEndDate,
    }));

  if (productionOrderRows.length > 0) {
    await db.insert(productionOrders).values(productionOrderRows);
  }

  const notificationRows = preparedProjects.flatMap(({ entry, productionOrderId }) => {
    if (!entry.assignedContractorId || !productionOrderId) return [];
    const contractor = contractorsById.get(entry.assignedContractorId);
    if (!contractor?.userId) return [];
    return [{
      id: randomUUID(),
      recipientUserId: contractor.userId,
      message: `Tienes un ambiente asignado: ${entry.ambience}`,
      relatedJobId: productionOrderId,
    }];
  });

  if (notificationRows.length > 0) {
    await db.insert(notifications).values(notificationRows);
  }

  res.status(201).json(await getHydratedQuotationById(quotationId));
});

router.put(
  '/:id/environment-projects/:environmentId',
  validate(updateQuotationEnvironmentProjectSchema),
  async (req: Request, res: Response) => {
    await ensureQuotationWorkflowSchema();
    const quotationId = req.params.id as string;
    const environmentId = req.params.environmentId as string;

    const [quotation] = await db.select().from(quotations).where(eq(quotations.id, quotationId));
    if (!quotation) {
      res.status(404).json({ error: 'Quotation not found' });
      return;
    }

    const [environment] = await db
      .select()
      .from(projectEnvironments)
      .where(and(eq(projectEnvironments.id, environmentId), eq(projectEnvironments.quotationId, quotationId)));

    if (!environment) {
      res.status(404).json({ error: 'Environment project not found' });
      return;
    }

    const payload = req.body as z.infer<typeof updateQuotationEnvironmentProjectSchema>;
    const nextClientPrice = Number(payload.clientPrice ?? payload.price ?? environment.clientPrice ?? environment.price ?? 0);
    const nextEnvironmentTotal = await getEnvironmentClientPriceTotal(quotationId, {
      environmentId,
      clientPrice: nextClientPrice,
    });
    const quotationLimit = getQuotationLimit(quotation);

    if (nextEnvironmentTotal > quotationLimit) {
      rejectEnvironmentBudgetOverflow(res, nextEnvironmentTotal, quotationLimit);
      return;
    }

    if (payload.assignedContractorId) {
      const [contractor] = await db
        .select({ id: contractors.id })
        .from(contractors)
        .where(eq(contractors.id, payload.assignedContractorId));

      if (!contractor) {
        res.status(400).json({ error: 'Assigned contractor was not found' });
        return;
      }
    }

    const nextStartDate = payload.estimatedStartDate ?? environment.estimatedStartDate;
    const nextEndDate = payload.estimatedEndDate ?? environment.estimatedEndDate;
    if (new Date(nextEndDate).getTime() < new Date(nextStartDate).getTime()) {
      res.status(400).json({ error: 'Environment project must have a valid estimated date range' });
      return;
    }

    const timestamp = new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/La_Paz',
    }).format(new Date());
    const noteBlock = `[${timestamp}] ${payload.modificationNote.trim()}`;
    const nextDescriptionBase = payload.description !== undefined ? payload.description?.trim() || '' : environment.description ?? '';
    const nextDescription = `${nextDescriptionBase}${nextDescriptionBase ? '\n\n' : ''}Nota de modificación: ${noteBlock}`;

    await db
      .update(projectEnvironments)
      .set({
        ...(payload.ambience !== undefined ? { ambience: payload.ambience.trim() } : {}),
        description: nextDescription,
        ...(payload.assignedContractorId !== undefined ? { assignedContractorId: payload.assignedContractorId ?? null } : {}),
        ...(payload.sketchupFileName !== undefined ? { sketchupFileName: payload.sketchupFileName?.trim() || null } : {}),
        ...(payload.sketchupFileUrl !== undefined ? { sketchupFileUrl: payload.sketchupFileUrl?.trim() || null } : {}),
        ...(payload.sketchupFileSize !== undefined ? { sketchupFileSize: payload.sketchupFileSize?.trim() || null } : {}),
        ...(payload.price !== undefined || payload.clientPrice !== undefined
          ? { price: String(nextClientPrice), clientPrice: String(nextClientPrice) }
          : {}),
        ...(payload.estimatedStartDate !== undefined ? { estimatedStartDate: payload.estimatedStartDate } : {}),
        ...(payload.estimatedEndDate !== undefined ? { estimatedEndDate: payload.estimatedEndDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectEnvironments.id, environmentId));

    if (environment.projectId) {
      await db
        .update(projects)
        .set({
          ...(payload.ambience !== undefined ? { name: payload.ambience.trim() } : {}),
          ...(payload.estimatedStartDate !== undefined ? { startDate: payload.estimatedStartDate } : {}),
          ...(payload.estimatedEndDate !== undefined ? { estimatedDeliveryDate: payload.estimatedEndDate } : {}),
          ...(payload.price !== undefined || payload.clientPrice !== undefined
            ? { budget: String(nextClientPrice), totalRevenue: String(nextClientPrice) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, environment.projectId));

      await db
        .update(productionOrders)
        .set({
          ...(payload.assignedContractorId !== undefined ? { assignedContractorId: payload.assignedContractorId ?? null } : {}),
          ...(payload.estimatedStartDate !== undefined ? { startDate: payload.estimatedStartDate } : {}),
          ...(payload.estimatedEndDate !== undefined ? { estimatedDeliveryDate: payload.estimatedEndDate } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(productionOrders.projectId, environment.projectId), eq(productionOrders.quotationId, quotationId)));
    }

    res.json(await getHydratedQuotationById(quotationId));
  },
);

export default router;
