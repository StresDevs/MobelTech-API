import { Router, Request, Response } from 'express';
import { desc, eq, inArray } from 'drizzle-orm';
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
  quotationItems,
  quotations,
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
  estimatedStartDate: dateInputSchema,
  estimatedEndDate: dateInputSchema,
  assignedContractorId: nullableUuidSchema,
});

const createQuotationEnvironmentProjectsSchema = z.object({
  projects: z.array(quotationEnvironmentSchema).min(1),
});

type QuotationRow = typeof quotations.$inferSelect;

async function hydrateQuotationRows(rows: Array<QuotationRow & { clientName?: string | null }>) {
  if (rows.length === 0) return [];

  const quotationIds = rows.map((row) => row.id);

  const [itemRows, linkedPrequotations, productionOrderRows, environmentRows] = await Promise.all([
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
        estimatedStartDate: projectEnvironments.estimatedStartDate,
        estimatedEndDate: projectEnvironments.estimatedEndDate,
        createdAt: projectEnvironments.createdAt,
        updatedAt: projectEnvironments.updatedAt,
      })
      .from(projectEnvironments)
      .where(inArray(projectEnvironments.quotationId, quotationIds)),
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
      auditLogs: [],
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
  const { items, totalAmount, advanceAmount, ...data } = req.body;

  const [current] = await db.select({ id: quotations.id }).from(quotations).where(eq(quotations.id, id));
  if (!current) {
    res.status(404).json({ error: 'Quotation not found' });
    return;
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
          userId: contractors.userId,
        })
        .from(contractors)
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

  for (const entry of payloadProjects) {
    const [project] = await db.insert(projects).values({
      name: entry.ambience.trim(),
      clientId: quotation.clientId,
      status: 'production',
      startDate: entry.estimatedStartDate,
      estimatedDeliveryDate: entry.estimatedEndDate,
      budget: String(entry.price),
      totalRevenue: String(entry.price),
    }).returning();

    const [environmentProject] = await db.insert(projectEnvironments).values({
      quotationId,
      projectId: project.id,
      assignedContractorId: entry.assignedContractorId ?? null,
      ambience: entry.ambience.trim(),
      description: entry.description?.trim() || null,
      sketchupFileName: entry.sketchupFileName?.trim() || null,
      sketchupFileUrl: entry.sketchupFileUrl?.trim() || null,
      sketchupFileSize: entry.sketchupFileSize?.trim() || null,
      price: String(entry.price),
      estimatedStartDate: entry.estimatedStartDate,
      estimatedEndDate: entry.estimatedEndDate,
    }).returning();

    if (entry.sketchupFileName && entry.sketchupFileData) {
      const [furnitureFile] = await db.insert(furnitureFiles).values({
        quotationId,
        projectEnvironmentId: environmentProject.id,
        clientId: quotation.clientId,
        assignedContractorId: entry.assignedContractorId ?? null,
        version: 1,
        fileName: entry.sketchupFileName.trim(),
        fileSize: entry.sketchupFileSize?.trim() || null,
        mimeType: 'application/octet-stream',
        fileData: entry.sketchupFileData,
        uploadedBy: entry.uploadedBy?.trim() || 'Usuario',
        notes: entry.ambience.trim(),
      }).returning();

      await db.insert(furnitureFileLogs).values({
        furnitureFileId: furnitureFile.id,
        action: 'file_uploaded',
        performedBy: entry.uploadedBy?.trim() || 'Usuario',
        description: `Archivo SketchUp inicial subido: ${entry.sketchupFileName.trim()} (v1)`,
      });
    }

    if (entry.assignedContractorId) {
      const contractor = contractorsById.get(entry.assignedContractorId);
      const [productionOrder] = await db.insert(productionOrders).values({
        projectId: project.id,
        quotationId,
        assignedContractorId: entry.assignedContractorId,
        status: 'pending',
        startDate: entry.estimatedStartDate,
        estimatedDeliveryDate: entry.estimatedEndDate,
      }).returning();

      if (contractor?.userId) {
        await db.insert(notifications).values({
          id: randomUUID(),
          recipientUserId: contractor.userId,
          message: `Tienes un ambiente asignado: ${entry.ambience}`,
          relatedJobId: productionOrder.id,
        });
      }

      await db.update(projectEnvironments)
        .set({ updatedAt: new Date() })
        .where(eq(projectEnvironments.id, environmentProject.id));
    }
  }

  res.status(201).json(await getHydratedQuotationById(quotationId));
});

export default router;
