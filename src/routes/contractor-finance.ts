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
  productionPhaseMachines,
  productionOrders,
  productionSchedulePhases,
  projects,
  users,
} from '../db/schema';
import { validate } from '../middleware/validate';
import { ensureContractorFinanceSchema } from '../db/ensure-contractor-finance';

const router = Router();

const boolishWithDefault = (defaultValue: boolean) => z.union([z.boolean(), z.string()]).optional().transform((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'false';
  return defaultValue;
});

const boolishSchema = boolishWithDefault(true);
const boolishFalseSchema = boolishWithDefault(false);
const optionalBoolishSchema = z.union([z.boolean(), z.string()]).optional().transform((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value !== 'false';
  return undefined;
});

const estimatedScheduleSchema = z.array(z.object({
  phaseKey: z.string().min(1).max(60),
  phaseLabel: z.string().min(1).max(120),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  cuttingMachine: z.string().max(160).optional().nullable(),
  machineLabel: z.string().max(160).optional().nullable(),
})).min(1, 'Completa el cronograma estimado antes de enviar la solicitud.');

const planLineSchema = z.object({
  id: z.string().uuid().optional(),
  phaseKey: z.string().min(1).max(60),
  phaseLabel: z.string().min(1).max(120),
  unit: z.string().min(1).max(30).optional(),
  width: z.union([z.number(), z.string()]).optional().default(0),
  heightQuantity: z.union([z.number(), z.string()]).optional().default(0),
  enableHeight: boolishSchema,
  enableWidthQuantity: boolishSchema,
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
  enableHeight: boolishSchema,
  enableWidthQuantity: boolishSchema,
  defaultHeight: z.union([z.number(), z.string()]).optional().default(0),
  defaultWidthQuantity: z.union([z.number(), z.string()]).optional().default(0),
  useDefaultHeight: boolishFalseSchema,
  useDefaultWidthQuantity: boolishFalseSchema,
  active: z.enum(['true', 'false']).optional().default('true'),
  sortOrder: z.number().int().optional().default(0),
});

const updateLaborCatalogItemSchema = z.object({
  itemKey: z.string().min(1).max(60).optional(),
  label: z.string().min(1).max(160).optional(),
  unit: z.string().min(1).max(30).optional(),
  defaultAmount: z.union([z.number(), z.string()]).optional(),
  referencePrice: z.union([z.number(), z.string()]).optional(),
  enableHeight: optionalBoolishSchema,
  enableWidthQuantity: optionalBoolishSchema,
  defaultHeight: z.union([z.number(), z.string()]).optional(),
  defaultWidthQuantity: z.union([z.number(), z.string()]).optional(),
  useDefaultHeight: optionalBoolishSchema,
  useDefaultWidthQuantity: optionalBoolishSchema,
  active: z.enum(['true', 'false']).optional(),
  sortOrder: z.number().int().optional(),
});

const planSchema = z.object({
  contractorId: z.string().uuid(),
  productionOrderId: z.string().uuid(),
  totalAmount: z.union([z.number(), z.string()]),
  lines: z.array(planLineSchema).min(1),
  estimatedSchedule: estimatedScheduleSchema,
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

function calculateMeasuredTotal(width: unknown, heightQuantity: unknown, enableHeight: boolean, enableWidthQuantity: boolean, fallback?: unknown) {
  const widthNumber = toNumber(width);
  const heightQuantityNumber = toNumber(heightQuantity);
  const calculated = (enableHeight ? widthNumber : 1) * (enableWidthQuantity ? heightQuantityNumber : 1);
  if (calculated > 0) return calculated;
  return toNumber(fallback);
}

function normalizeEstimatedSchedule(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const schedule = entry as {
        phaseKey?: unknown;
        phaseLabel?: unknown;
        startDate?: unknown;
        endDate?: unknown;
        cuttingMachine?: unknown;
        machineLabel?: unknown;
      };
      return {
        phaseKey: String(schedule.phaseKey ?? ''),
        phaseLabel: String(schedule.phaseLabel ?? ''),
        startDate: String(schedule.startDate ?? ''),
        endDate: String(schedule.endDate ?? ''),
        cuttingMachine: schedule.cuttingMachine ? String(schedule.cuttingMachine) : null,
        machineLabel: schedule.machineLabel ? String(schedule.machineLabel) : null,
      };
    })
    .filter((entry): entry is {
      phaseKey: string;
      phaseLabel: string;
      startDate: string;
      endDate: string;
      cuttingMachine: string | null;
      machineLabel: string | null;
    } => (
      Boolean(entry?.phaseKey && entry.phaseLabel && entry.startDate && entry.endDate)
    ));
}

function validateEstimatedSchedule(schedule: Array<{ phaseKey: string; phaseLabel: string; startDate: string; endDate: string }>) {
  for (const phase of schedule) {
    const startDate = new Date(`${phase.startDate}T00:00:00`);
    const endDate = new Date(`${phase.endDate}T00:00:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return 'El cronograma tiene fechas inválidas.';
    }
    if (endDate < startDate) {
      return `La etapa "${phase.phaseLabel}" no puede terminar antes de iniciar.`;
    }
  }
  return null;
}

function normalizeLaborItem(row: typeof contractorLaborCatalogItems.$inferSelect) {
  return {
    ...row,
    unit: row.unit || 'UND',
    defaultAmount: toNumber(row.defaultAmount),
    referencePrice: toNumber(row.defaultAmount),
    enableHeight: row.enableHeight,
    enableWidthQuantity: row.enableWidthQuantity,
    defaultHeight: toNumber(row.defaultHeight),
    defaultWidthQuantity: toNumber(row.defaultWidthQuantity),
    useDefaultHeight: row.useDefaultHeight,
    useDefaultWidthQuantity: row.useDefaultWidthQuantity,
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

async function notifyContractorPlanReview(planId: string, reviewStatus: 'approved' | 'rejected') {
  const [plan] = await db
    .select({
      contractorUserId: users.id,
      productionOrderId: contractorPaymentPlans.productionOrderId,
      jobName: projects.name,
      reviewNotes: contractorPaymentPlans.reviewNotes,
    })
    .from(contractorPaymentPlans)
    .leftJoin(contractors, eq(contractorPaymentPlans.contractorId, contractors.id))
    .leftJoin(users, eq(contractors.userId, users.id))
    .leftJoin(productionOrders, eq(contractorPaymentPlans.productionOrderId, productionOrders.id))
    .leftJoin(projects, eq(productionOrders.projectId, projects.id))
    .where(eq(contractorPaymentPlans.id, planId));

  if (!plan?.contractorUserId) return;

  const jobLabel = plan.jobName ? ` para ${plan.jobName}` : '';
  const rejectionReason = plan.reviewNotes ? `: ${plan.reviewNotes}` : '.';
  const message = reviewStatus === 'approved'
    ? `Tu solicitud de pago de mano de obra${jobLabel} fue aprobada.`
    : `Tu solicitud de pago de mano de obra${jobLabel} fue rechazada${rejectionReason}`;

  await db.insert(notifications).values({
    id: randomUUID(),
    recipientUserId: plan.contractorUserId,
    message,
    relatedJobId: plan.productionOrderId,
  });
}

async function notifyContractorAdvanceReview(requestId: string, status: 'approved' | 'rejected' | 'paid') {
  const [request] = await db
    .select({
      contractorUserId: users.id,
      productionOrderId: contractorAdvanceRequests.productionOrderId,
      jobName: projects.name,
      reviewNotes: contractorAdvanceRequests.reviewNotes,
    })
    .from(contractorAdvanceRequests)
    .leftJoin(contractors, eq(contractorAdvanceRequests.contractorId, contractors.id))
    .leftJoin(users, eq(contractors.userId, users.id))
    .leftJoin(productionOrders, eq(contractorAdvanceRequests.productionOrderId, productionOrders.id))
    .leftJoin(projects, eq(productionOrders.projectId, projects.id))
    .where(eq(contractorAdvanceRequests.id, requestId));

  if (!request?.contractorUserId) return;

  const jobLabel = request.jobName ? ` para ${request.jobName}` : '';
  const rejectionReason = request.reviewNotes ? `: ${request.reviewNotes}` : '.';
  const message = status === 'approved'
    ? `Tu solicitud de anticipo${jobLabel} fue aprobada.`
    : status === 'paid'
      ? `Tu solicitud de anticipo${jobLabel} fue marcada como pagada.`
      : `Tu solicitud de anticipo${jobLabel} fue rechazada${rejectionReason}`;

  await db.insert(notifications).values({
    id: randomUUID(),
    recipientUserId: request.contractorUserId,
    message,
    relatedJobId: request.productionOrderId,
  });
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
      estimatedSchedule: contractorPaymentPlans.estimatedSchedule,
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

  const productionOrderIds = Array.from(new Set(rows.map((row) => row.productionOrderId)));
  const [schedulePhaseRows, phaseMachineRows] = await Promise.all([
    productionOrderIds.length > 0
      ? db
          .select()
          .from(productionSchedulePhases)
          .where(inArray(productionSchedulePhases.productionOrderId, productionOrderIds))
      : Promise.resolve([]),
    db.select().from(productionPhaseMachines),
  ]);
  const schedulePhasesByOrderId = new Map<string, typeof schedulePhaseRows>();
  schedulePhaseRows
    .filter((phase) => phase.type === 'actual')
    .forEach((phase) => {
      const current = schedulePhasesByOrderId.get(phase.productionOrderId) ?? [];
      current.push(phase);
      schedulePhasesByOrderId.set(phase.productionOrderId, current);
    });
  const machineLabelByValue = new Map<string, string>();
  phaseMachineRows.forEach((machine) => {
    machineLabelByValue.set(machine.id.toLowerCase(), machine.name);
    machineLabelByValue.set(machine.name.toLowerCase(), machine.name);
  });

  function getMachineLabel(value?: string | null) {
    if (!value) return null;
    return machineLabelByValue.get(value.toLowerCase()) ?? value;
  }

  function enrichEstimatedSchedule(productionOrderId: string, estimatedSchedule: unknown) {
    const normalizedSchedule = normalizeEstimatedSchedule(estimatedSchedule);
    const actualPhases = schedulePhasesByOrderId.get(productionOrderId) ?? [];
    const actualByPhase = new Map<string, typeof actualPhases[number]>(
      actualPhases.map((phase) => [phase.phase, phase]),
    );

    return normalizedSchedule.map((phase) => {
      const actualPhase = actualByPhase.get(phase.phaseKey);
      const cuttingMachine = actualPhase?.cuttingMachine ?? phase.cuttingMachine ?? null;
      return {
        ...phase,
        startDate: actualPhase?.startDate ?? phase.startDate,
        endDate: actualPhase?.endDate ?? phase.endDate,
        cuttingMachine,
        machineLabel: getMachineLabel(cuttingMachine) ?? phase.machineLabel ?? null,
      };
    });
  }

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
      estimatedSchedule: enrichEstimatedSchedule(row.productionOrderId, row.estimatedSchedule),
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
          enableHeight: line.enableHeight,
          enableWidthQuantity: line.enableWidthQuantity,
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
      enableHeight: req.body.enableHeight ?? true,
      enableWidthQuantity: req.body.enableWidthQuantity ?? true,
      defaultHeight: measurement(req.body.defaultHeight ?? 0),
      defaultWidthQuantity: measurement(req.body.defaultWidthQuantity ?? 0),
      useDefaultHeight: req.body.useDefaultHeight ?? false,
      useDefaultWidthQuantity: req.body.useDefaultWidthQuantity ?? false,
      active: req.body.active ?? 'true',
      sortOrder: req.body.sortOrder ?? 0,
    })
    .returning();

  res.status(201).json(normalizeLaborItem(created));
});

router.put('/labor-items/:id', validate(updateLaborCatalogItemSchema), async (req, res) => {
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
      ...(req.body.enableHeight !== undefined ? { enableHeight: req.body.enableHeight } : {}),
      ...(req.body.enableWidthQuantity !== undefined ? { enableWidthQuantity: req.body.enableWidthQuantity } : {}),
      ...(req.body.defaultHeight !== undefined ? { defaultHeight: measurement(req.body.defaultHeight) } : {}),
      ...(req.body.defaultWidthQuantity !== undefined ? { defaultWidthQuantity: measurement(req.body.defaultWidthQuantity) } : {}),
      ...(req.body.useDefaultHeight !== undefined ? { useDefaultHeight: req.body.useDefaultHeight } : {}),
      ...(req.body.useDefaultWidthQuantity !== undefined ? { useDefaultWidthQuantity: req.body.useDefaultWidthQuantity } : {}),
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
  const schedule = normalizeEstimatedSchedule(req.body.estimatedSchedule);
  if (schedule.length === 0) {
    res.status(400).json({ error: 'Completa el cronograma estimado antes de enviar la solicitud.' });
    return;
  }
  const scheduleError = validateEstimatedSchedule(schedule);
  if (scheduleError) {
    res.status(400).json({ error: scheduleError });
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
        .set({
          totalAmount: money(totalAmount),
          estimatedSchedule: schedule,
          reviewStatus: 'submitted',
          reviewNotes: null,
          updatedAt: new Date(),
        })
        .where(eq(contractorPaymentPlans.id, existing.id))
        .returning()
    : await db
        .insert(contractorPaymentPlans)
        .values({
          contractorId: req.body.contractorId,
          productionOrderId: req.body.productionOrderId,
          totalAmount: money(totalAmount),
          estimatedSchedule: schedule,
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
    const enableHeight = catalogItem ? catalogItem.enableHeight : line.enableHeight;
    const enableWidthQuantity = catalogItem ? catalogItem.enableWidthQuantity : line.enableWidthQuantity;
    const width = enableHeight
      ? (catalogItem?.useDefaultHeight ? toNumber(catalogItem.defaultHeight) : toNumber(line.width))
      : 0;
    const heightQuantity = enableWidthQuantity
      ? (catalogItem?.useDefaultWidthQuantity ? toNumber(catalogItem.defaultWidthQuantity) : toNumber(line.heightQuantity))
      : 0;
    const measuredTotal = calculateMeasuredTotal(width, heightQuantity, enableHeight, enableWidthQuantity, line.measuredTotal);
    const plannedAmount = measuredTotal > 0 && unitPrice > 0
      ? measuredTotal * unitPrice
      : toNumber(line.plannedAmount);
    const lineValues = {
      phaseKey: line.phaseKey,
      phaseLabel: catalogItem?.label ?? line.phaseLabel,
      unit: catalogItem?.unit ?? line.unit ?? 'UND',
      width: measurement(width),
      heightQuantity: measurement(heightQuantity),
      enableHeight,
      enableWidthQuantity,
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
  const [existingPlan] = await db
    .select({
      id: contractorPaymentPlans.id,
      reviewStatus: contractorPaymentPlans.reviewStatus,
    })
    .from(contractorPaymentPlans)
    .where(eq(contractorPaymentPlans.id, req.params.id as string));

  if (!existingPlan) {
    res.status(404).json({ error: 'Plan de mano de obra no encontrado' });
    return;
  }

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

  const shouldNotifyContractor =
    existingPlan.reviewStatus !== req.body.reviewStatus &&
    (req.body.reviewStatus === 'approved' || req.body.reviewStatus === 'rejected');

  if (shouldNotifyContractor) {
    await notifyContractorPlanReview(plan.id, req.body.reviewStatus);
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

  const existingRequests = await db
    .select()
    .from(contractorAdvanceRequests)
    .where(eq(contractorAdvanceRequests.planId, req.body.planId))
    .orderBy(desc(contractorAdvanceRequests.requestedAt), desc(contractorAdvanceRequests.createdAt));
  const activeRequest = existingRequests.find((request) => request.status !== 'rejected');

  if (activeRequest) {
    res.status(409).json({ error: 'Este trabajo ya tiene una solicitud de anticipo activa.' });
    return;
  }

  const [contractor] = await db
    .select({ name: contractors.name })
    .from(contractors)
    .where(eq(contractors.id, req.body.contractorId));

  const rejectedRequest = existingRequests.find((request) => request.status === 'rejected');
  const [saved] = rejectedRequest
    ? await db
        .update(contractorAdvanceRequests)
        .set({
          amount: money(amount),
          notes: req.body.notes ?? null,
          status: 'submitted',
          reviewNotes: null,
          requestedAt: new Date(),
          reviewedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(contractorAdvanceRequests.id, rejectedRequest.id))
        .returning()
    : await db
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

  res.status(rejectedRequest ? 200 : 201).json(normalizeAdvanceRequest(saved));
});

router.patch('/advance-requests/:id/review', validate(reviewAdvanceSchema), async (req, res) => {
  await ensureContractorFinanceSchema();
  const [existing] = await db
    .select({ id: contractorAdvanceRequests.id, status: contractorAdvanceRequests.status })
    .from(contractorAdvanceRequests)
    .where(eq(contractorAdvanceRequests.id, req.params.id as string));

  if (!existing) {
    res.status(404).json({ error: 'Solicitud de anticipo no encontrada' });
    return;
  }

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

  if (existing.status !== req.body.status && req.body.status !== 'submitted') {
    await notifyContractorAdvanceReview(updated.id, req.body.status);
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
