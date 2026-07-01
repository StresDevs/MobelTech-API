import { randomUUID } from 'crypto';
import { Router } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  contractorAdvanceRequests,
  contractorLaborCatalogItems,
  contractorPaymentPlanLines,
  contractorPaymentPlans,
  contractorPayments,
  contractors,
  notifications,
  productionOrders,
  projects,
  users,
} from '../db/schema';
import { validate } from '../middleware/validate';
import { ensureContractorFinanceSchema } from '../db/ensure-contractor-finance';

const router = Router();

const planLineSchema = z.object({
  id: z.string().uuid().optional(),
  phaseKey: z.string().min(1).max(60),
  phaseLabel: z.string().min(1).max(120),
  unit: z.string().min(1).max(30).optional(),
  width: z.union([z.number(), z.string()]).optional().default(0),
  heightQuantity: z.union([z.number(), z.string()]).optional().default(0),
  measuredTotal: z.union([z.number(), z.string()]).optional(),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  plannedAmount: z.union([z.number(), z.string()]).optional().default(0),
  sortOrder: z.number().int().optional().default(0),
});

const laborCatalogItemSchema = z.object({
  itemKey: z.string().min(1).max(60),
  label: z.string().min(1).max(160),
  unit: z.string().min(1).max(30).optional().default('UND'),
  defaultAmount: z.union([z.number(), z.string()]).optional(),
  referencePrice: z.union([z.number(), z.string()]).optional(),
  active: z.enum(['true', 'false']).optional().default('true'),
  sortOrder: z.number().int().optional().default(0),
});

const planSchema = z.object({
  contractorId: z.string().uuid(),
  productionOrderId: z.string().uuid(),
  totalAmount: z.union([z.number(), z.string()]),
  lines: z.array(planLineSchema).min(1),
});

const paymentSchema = z.object({
  planId: z.string().uuid(),
  lineId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  paymentDate: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const reviewPlanSchema = z.object({
  reviewStatus: z.enum(['submitted', 'approved', 'rejected']),
  reviewNotes: z.string().optional().nullable(),
});

const advanceRequestSchema = z.object({
  planId: z.string().uuid(),
  contractorId: z.string().uuid(),
  productionOrderId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  notes: z.string().optional().nullable(),
});

const reviewAdvanceSchema = z.object({
  status: z.enum(['submitted', 'approved', 'rejected', 'paid']),
  reviewNotes: z.string().optional().nullable(),
});

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value: unknown) {
  return String(toNumber(value).toFixed(2));
}

function measurement(value: unknown) {
  return String(toNumber(value).toFixed(3));
}

function calculateMeasuredTotal(width: unknown, heightQuantity: unknown, fallback?: unknown) {
  const widthNumber = toNumber(width);
  const heightQuantityNumber = toNumber(heightQuantity);
  const calculated = widthNumber * heightQuantityNumber;
  if (calculated > 0) return calculated;
  return toNumber(fallback);
}

function normalizeLaborItem(row: typeof contractorLaborCatalogItems.$inferSelect) {
  return {
    ...row,
    unit: row.unit || 'UND',
    defaultAmount: toNumber(row.defaultAmount),
    referencePrice: toNumber(row.defaultAmount),
    active: row.active !== 'false',
  };
}

function normalizeAdvanceRequest(row: typeof contractorAdvanceRequests.$inferSelect & {
  contractorName?: string | null;
  jobName?: string | null;
}) {
  return {
    ...row,
    amount: toNumber(row.amount),
    contractorName: row.contractorName ?? 'Contratista',
    jobName: row.jobName ?? 'Trabajo sin nombre',
  };
}

async function getOperationsRecipients() {
  return db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.role, 'admin'), eq(users.role, 'architect')));
}

async function notifyOperations(message: string, relatedJobId?: string | null) {
  const recipients = await getOperationsRecipients();
  if (recipients.length === 0) return;

  await db.insert(notifications).values(
    recipients.map((recipient) => ({
      id: randomUUID(),
      recipientUserId: recipient.id,
      message,
      relatedJobId: relatedJobId ?? null,
    })),
  );
}

async function hydratePlans(filters?: {
  contractorId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}) {
  const conditions = [
    filters?.contractorId ? eq(contractorPaymentPlans.contractorId, filters.contractorId) : undefined,
    filters?.search
      ? or(
          ilike(contractors.name, `%${filters.search}%`),
          ilike(projects.name, `%${filters.search}%`),
        )
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: contractorPaymentPlans.id,
      contractorId: contractorPaymentPlans.contractorId,
      productionOrderId: contractorPaymentPlans.productionOrderId,
      totalAmount: contractorPaymentPlans.totalAmount,
      reviewStatus: contractorPaymentPlans.reviewStatus,
      reviewNotes: contractorPaymentPlans.reviewNotes,
      createdAt: contractorPaymentPlans.createdAt,
      updatedAt: contractorPaymentPlans.updatedAt,
      contractorName: contractors.name,
      jobName: projects.name,
    })
    .from(contractorPaymentPlans)
    .leftJoin(contractors, eq(contractorPaymentPlans.contractorId, contractors.id))
    .leftJoin(productionOrders, eq(contractorPaymentPlans.productionOrderId, productionOrders.id))
    .leftJoin(projects, eq(productionOrders.projectId, projects.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contractorPaymentPlans.updatedAt));

  if (rows.length === 0) return [];

  const planIds = rows.map((row) => row.id);
  const lines = await db
    .select()
    .from(contractorPaymentPlanLines)
    .where(inArray(contractorPaymentPlanLines.planId, planIds))
    .orderBy(asc(contractorPaymentPlanLines.sortOrder));

  const paymentConditions = [
    inArray(contractorPayments.planId, planIds),
    filters?.startDate ? gte(contractorPayments.paymentDate, filters.startDate) : undefined,
    filters?.endDate ? lte(contractorPayments.paymentDate, filters.endDate) : undefined,
  ].filter(Boolean);

  const payments = await db
    .select()
    .from(contractorPayments)
    .where(and(...paymentConditions))
    .orderBy(desc(contractorPayments.paymentDate), desc(contractorPayments.createdAt));

  return rows.map((row) => {
    const planLines = lines.filter((line) => line.planId === row.id);
    const planPayments = payments.filter((payment) => payment.planId === row.id);
    const paidAmount = planPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const totalAmount = toNumber(row.totalAmount);

    return {
      ...row,
      contractorName: row.contractorName ?? 'Contratista',
      jobName: row.jobName ?? 'Trabajo sin nombre',
      totalAmount,
      reviewStatus: row.reviewStatus,
      reviewNotes: row.reviewNotes,
      paidAmount,
      remainingAmount: Math.max(totalAmount - paidAmount, 0),
      lines: planLines.map((line) => {
        const linePayments = planPayments.filter((payment) => payment.lineId === line.id);
        const linePaidAmount = linePayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
        const plannedAmount = toNumber(line.plannedAmount);

        return {
          ...line,
          unit: line.unit || 'UND',
          width: toNumber(line.width),
          heightQuantity: toNumber(line.heightQuantity),
          measuredTotal: toNumber(line.measuredTotal),
          unitPrice: toNumber(line.unitPrice),
          plannedAmount,
          paidAmount: linePaidAmount,
          remainingAmount: Math.max(plannedAmount - linePaidAmount, 0),
          payments: linePayments.map((payment) => ({
            ...payment,
            amount: toNumber(payment.amount),
          })),
        };
      }),
      payments: planPayments.map((payment) => ({
        ...payment,
        amount: toNumber(payment.amount),
      })),
    };
  });
}

router.get('/options', async (_req, res) => {
  await ensureContractorFinanceSchema();
  const contractorRows = await db
    .select({
      id: contractors.id,
      name: contractors.name,
      status: contractors.status,
    })
    .from(contractors)
    .orderBy(asc(contractors.name));

  const orderRows = await db
    .select({
      id: productionOrders.id,
      contractorId: productionOrders.assignedContractorId,
      status: productionOrders.status,
      projectName: projects.name,
      projectBudget: projects.budget,
      createdAt: productionOrders.createdAt,
    })
    .from(productionOrders)
    .leftJoin(projects, eq(productionOrders.projectId, projects.id))
    .orderBy(desc(productionOrders.createdAt));

  res.json({
    contractors: contractorRows,
    jobs: orderRows.map((row) => ({
      id: row.id,
      contractorId: row.contractorId,
      name: row.projectName ?? 'Trabajo sin nombre',
      status: row.status,
      amount: toNumber(row.projectBudget),
    })),
  });
});

router.get('/labor-items', async (req, res) => {
  await ensureContractorFinanceSchema();
  const activeOnly = req.query.activeOnly !== 'false';
  const rows = await db
    .select()
    .from(contractorLaborCatalogItems)
    .where(activeOnly ? eq(contractorLaborCatalogItems.active, 'true') : undefined)
    .orderBy(asc(contractorLaborCatalogItems.sortOrder), asc(contractorLaborCatalogItems.label));

  res.json(rows.map(normalizeLaborItem));
});

router.post('/labor-items', validate(laborCatalogItemSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const referencePrice = req.body.referencePrice ?? req.body.defaultAmount ?? 0;
  const [created] = await db
    .insert(contractorLaborCatalogItems)
    .values({
      itemKey: req.body.itemKey.trim(),
      label: req.body.label.trim(),
      unit: (req.body.unit ?? 'UND').trim().toUpperCase(),
      defaultAmount: money(referencePrice),
      active: req.body.active ?? 'true',
      sortOrder: req.body.sortOrder ?? 0,
    })
    .returning();

  res.status(201).json(normalizeLaborItem(created));
});

router.put('/labor-items/:id', validate(laborCatalogItemSchema.partial()), async (req, res) => {
  await ensureContractorFinanceSchema();
  const [updated] = await db
    .update(contractorLaborCatalogItems)
    .set({
      ...(req.body.itemKey !== undefined ? { itemKey: req.body.itemKey.trim() } : {}),
      ...(req.body.label !== undefined ? { label: req.body.label.trim() } : {}),
      ...(req.body.unit !== undefined ? { unit: req.body.unit.trim().toUpperCase() } : {}),
      ...(req.body.defaultAmount !== undefined || req.body.referencePrice !== undefined
        ? { defaultAmount: money(req.body.referencePrice ?? req.body.defaultAmount) }
        : {}),
      ...(req.body.active !== undefined ? { active: req.body.active } : {}),
      ...(req.body.sortOrder !== undefined ? { sortOrder: req.body.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(contractorLaborCatalogItems.id, req.params.id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Item de mano de obra no encontrado' });
    return;
  }

  res.json(normalizeLaborItem(updated));
});

router.get('/plans', async (req, res) => {
  await ensureContractorFinanceSchema();
  const plans = await hydratePlans({
    contractorId: typeof req.query.contractorId === 'string' && req.query.contractorId !== 'all' ? req.query.contractorId : undefined,
    search: typeof req.query.search === 'string' ? req.query.search.trim() : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  });
  res.json(plans);
});

router.post('/plans', validate(planSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const totalAmount = toNumber(req.body.totalAmount);
  if (totalAmount <= 0) {
    res.status(400).json({ error: 'El monto total debe ser mayor a 0' });
    return;
  }

  const [contractor] = await db
    .select({ id: contractors.id, name: contractors.name })
    .from(contractors)
    .where(eq(contractors.id, req.body.contractorId));

  if (!contractor) {
    res.status(400).json({ error: 'Contratista no encontrado' });
    return;
  }

  const [order] = await db
    .select({ id: productionOrders.id, contractorId: productionOrders.assignedContractorId })
    .from(productionOrders)
    .where(eq(productionOrders.id, req.body.productionOrderId));

  if (!order) {
    res.status(400).json({ error: 'Trabajo no encontrado' });
    return;
  }

  if (order.contractorId && order.contractorId !== req.body.contractorId) {
    res.status(400).json({ error: 'El trabajo seleccionado pertenece a otro contratista' });
    return;
  }

  const [existing] = await db
    .select({ id: contractorPaymentPlans.id })
    .from(contractorPaymentPlans)
    .where(and(
      eq(contractorPaymentPlans.contractorId, req.body.contractorId),
      eq(contractorPaymentPlans.productionOrderId, req.body.productionOrderId),
    ));

  const [plan] = existing
    ? await db
        .update(contractorPaymentPlans)
        .set({ totalAmount: money(totalAmount), reviewStatus: 'submitted', reviewNotes: null, updatedAt: new Date() })
        .where(eq(contractorPaymentPlans.id, existing.id))
        .returning()
    : await db
        .insert(contractorPaymentPlans)
        .values({
          contractorId: req.body.contractorId,
          productionOrderId: req.body.productionOrderId,
          totalAmount: money(totalAmount),
          reviewStatus: 'submitted',
          reviewNotes: null,
        })
        .returning();

  const currentLines = await db
    .select()
    .from(contractorPaymentPlanLines)
    .where(eq(contractorPaymentPlanLines.planId, plan.id));

  const requestedKeys = req.body.lines.map((line: z.infer<typeof planLineSchema>) => line.phaseKey);
  const catalogRows = requestedKeys.length
    ? await db
        .select()
        .from(contractorLaborCatalogItems)
        .where(inArray(contractorLaborCatalogItems.itemKey, requestedKeys))
    : [];
  const catalogByKey = new Map(catalogRows.map((item) => [item.itemKey, item]));

  const plannedKeptLineIds = new Set(
    req.body.lines
      .map((line: z.infer<typeof planLineSchema>) => {
        const existingLine = currentLines.find((entry) => entry.id === line.id || entry.phaseKey === line.phaseKey);
        return existingLine?.id;
      })
      .filter(Boolean),
  );
  const removedLines = currentLines.filter((line) => !plannedKeptLineIds.has(line.id));

  for (const line of removedLines) {
    const existingPayments = await db
      .select({ id: contractorPayments.id })
      .from(contractorPayments)
      .where(eq(contractorPayments.lineId, line.id))
      .limit(1);

    if (existingPayments.length > 0) {
      res.status(400).json({ error: `No se puede eliminar la fase "${line.phaseLabel}" porque ya tiene pagos registrados` });
      return;
    }
  }

  for (const [index, line] of req.body.lines.entries() as IterableIterator<[number, z.infer<typeof planLineSchema>]>) {
    const existingLine = currentLines.find((entry) => entry.id === line.id || entry.phaseKey === line.phaseKey);
    const catalogItem = catalogByKey.get(line.phaseKey);
    const unitPrice = catalogItem ? toNumber(catalogItem.defaultAmount) : toNumber(line.unitPrice);
    const width = toNumber(line.width);
    const heightQuantity = toNumber(line.heightQuantity);
    const measuredTotal = calculateMeasuredTotal(width, heightQuantity, line.measuredTotal);
    const plannedAmount = measuredTotal > 0 && unitPrice > 0
      ? measuredTotal * unitPrice
      : toNumber(line.plannedAmount);
    const lineValues = {
      phaseKey: line.phaseKey,
      phaseLabel: catalogItem?.label ?? line.phaseLabel,
      unit: catalogItem?.unit ?? line.unit ?? 'UND',
      width: measurement(width),
      heightQuantity: measurement(heightQuantity),
      measuredTotal: measurement(measuredTotal),
      unitPrice: money(unitPrice),
      plannedAmount: money(plannedAmount),
      sortOrder: line.sortOrder ?? index,
      updatedAt: new Date(),
    };

    if (existingLine) {
      await db
        .update(contractorPaymentPlanLines)
        .set(lineValues)
        .where(eq(contractorPaymentPlanLines.id, existingLine.id));
    } else {
      await db.insert(contractorPaymentPlanLines).values({
        planId: plan.id,
        ...lineValues,
      });
    }
  }

  for (const line of removedLines) {
    await db.delete(contractorPaymentPlanLines).where(eq(contractorPaymentPlanLines.id, line.id));
  }

  await notifyOperations(
    `Nueva solicitud de pago de mano de obra de ${contractor.name}.`,
    plan.productionOrderId,
  );

  const updatedPlans = await hydratePlans();
  res.status(existing ? 200 : 201).json(updatedPlans.find((entry) => entry.id === plan.id) ?? null);
});

router.patch('/plans/:id/review', validate(reviewPlanSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const [plan] = await db
    .update(contractorPaymentPlans)
    .set({
      reviewStatus: req.body.reviewStatus,
      reviewNotes: req.body.reviewNotes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(contractorPaymentPlans.id, req.params.id as string))
    .returning();

  if (!plan) {
    res.status(404).json({ error: 'Plan de mano de obra no encontrado' });
    return;
  }

  const updatedPlans = await hydratePlans();
  res.json(updatedPlans.find((entry) => entry.id === plan.id) ?? null);
});

router.get('/advance-requests', async (req, res) => {
  await ensureContractorFinanceSchema();
  const conditions = [
    typeof req.query.contractorId === 'string' ? eq(contractorAdvanceRequests.contractorId, req.query.contractorId) : undefined,
    typeof req.query.planId === 'string' ? eq(contractorAdvanceRequests.planId, req.query.planId) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: contractorAdvanceRequests.id,
      planId: contractorAdvanceRequests.planId,
      contractorId: contractorAdvanceRequests.contractorId,
      productionOrderId: contractorAdvanceRequests.productionOrderId,
      amount: contractorAdvanceRequests.amount,
      status: contractorAdvanceRequests.status,
      notes: contractorAdvanceRequests.notes,
      reviewNotes: contractorAdvanceRequests.reviewNotes,
      requestedAt: contractorAdvanceRequests.requestedAt,
      reviewedAt: contractorAdvanceRequests.reviewedAt,
      createdAt: contractorAdvanceRequests.createdAt,
      updatedAt: contractorAdvanceRequests.updatedAt,
      contractorName: contractors.name,
      jobName: projects.name,
    })
    .from(contractorAdvanceRequests)
    .leftJoin(contractors, eq(contractorAdvanceRequests.contractorId, contractors.id))
    .leftJoin(productionOrders, eq(contractorAdvanceRequests.productionOrderId, productionOrders.id))
    .leftJoin(projects, eq(productionOrders.projectId, projects.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contractorAdvanceRequests.requestedAt));

  res.json(rows.map(normalizeAdvanceRequest));
});

router.post('/advance-requests', validate(advanceRequestSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const amount = toNumber(req.body.amount);
  if (amount <= 0) {
    res.status(400).json({ error: 'El anticipo debe ser mayor a 0' });
    return;
  }

  const [plan] = await db
    .select({
      id: contractorPaymentPlans.id,
      contractorId: contractorPaymentPlans.contractorId,
      productionOrderId: contractorPaymentPlans.productionOrderId,
      totalAmount: contractorPaymentPlans.totalAmount,
      reviewStatus: contractorPaymentPlans.reviewStatus,
    })
    .from(contractorPaymentPlans)
    .where(eq(contractorPaymentPlans.id, req.body.planId));

  if (!plan || plan.contractorId !== req.body.contractorId || plan.productionOrderId !== req.body.productionOrderId) {
    res.status(400).json({ error: 'El plan de mano de obra no coincide con el trabajo seleccionado' });
    return;
  }
  if (plan.reviewStatus !== 'approved') {
    res.status(400).json({ error: 'La mano de obra debe estar aprobada antes de solicitar anticipo' });
    return;
  }
  if (amount > toNumber(plan.totalAmount)) {
    res.status(400).json({ error: 'El anticipo no puede superar el total aprobado' });
    return;
  }

  const [contractor] = await db
    .select({ name: contractors.name })
    .from(contractors)
    .where(eq(contractors.id, req.body.contractorId));

  const [created] = await db
    .insert(contractorAdvanceRequests)
    .values({
      planId: req.body.planId,
      contractorId: req.body.contractorId,
      productionOrderId: req.body.productionOrderId,
      amount: money(amount),
      notes: req.body.notes ?? null,
      status: 'submitted',
      reviewNotes: null,
    })
    .returning();

  await notifyOperations(
    `Nueva solicitud de anticipo de mano de obra de ${contractor?.name ?? 'un contratista'}.`,
    req.body.productionOrderId,
  );

  res.status(201).json(normalizeAdvanceRequest(created));
});

router.patch('/advance-requests/:id/review', validate(reviewAdvanceSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const [updated] = await db
    .update(contractorAdvanceRequests)
    .set({
      status: req.body.status,
      reviewNotes: req.body.reviewNotes?.trim() || null,
      reviewedAt: req.body.status === 'submitted' ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contractorAdvanceRequests.id, req.params.id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Solicitud de anticipo no encontrada' });
    return;
  }

  res.json(normalizeAdvanceRequest(updated));
});

router.post('/payments', validate(paymentSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const amount = toNumber(req.body.amount);
  if (amount <= 0) {
    res.status(400).json({ error: 'El monto del pago debe ser mayor a 0' });
    return;
  }

  const [line] = await db
    .select({ id: contractorPaymentPlanLines.id, planId: contractorPaymentPlanLines.planId })
    .from(contractorPaymentPlanLines)
    .where(eq(contractorPaymentPlanLines.id, req.body.lineId));

  if (!line || line.planId !== req.body.planId) {
    res.status(400).json({ error: 'La fase seleccionada no pertenece al plan' });
    return;
  }

  const [payment] = await db
    .insert(contractorPayments)
    .values({
      planId: req.body.planId,
      lineId: req.body.lineId,
      amount: money(amount),
      paymentDate: req.body.paymentDate,
      notes: req.body.notes ?? null,
    })
    .returning();

  res.status(201).json({ ...payment, amount: toNumber(payment.amount) });
});

export default router;
