import { Router } from 'express';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  contractorPaymentPlanLines,
  contractorPaymentPlans,
  contractorPayments,
  contractors,
  productionOrders,
  projects,
} from '../db/schema';
import { validate } from '../middleware/validate';

const router = Router();

const planLineSchema = z.object({
  id: z.string().uuid().optional(),
  phaseKey: z.string().min(1).max(40),
  phaseLabel: z.string().min(1).max(120),
  plannedAmount: z.union([z.number(), z.string()]).optional().default(0),
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

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value: unknown) {
  return String(toNumber(value).toFixed(2));
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
      paidAmount,
      remainingAmount: Math.max(totalAmount - paidAmount, 0),
      lines: planLines.map((line) => {
        const linePayments = planPayments.filter((payment) => payment.lineId === line.id);
        const linePaidAmount = linePayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
        const plannedAmount = toNumber(line.plannedAmount);

        return {
          ...line,
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

router.get('/plans', async (req, res) => {
  const plans = await hydratePlans({
    contractorId: typeof req.query.contractorId === 'string' && req.query.contractorId !== 'all' ? req.query.contractorId : undefined,
    search: typeof req.query.search === 'string' ? req.query.search.trim() : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
  });
  res.json(plans);
});

router.post('/plans', validate(planSchema), async (req, res) => {
  const totalAmount = toNumber(req.body.totalAmount);
  if (totalAmount <= 0) {
    res.status(400).json({ error: 'El monto total debe ser mayor a 0' });
    return;
  }

  const [contractor] = await db
    .select({ id: contractors.id })
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
        .set({ totalAmount: money(totalAmount), updatedAt: new Date() })
        .where(eq(contractorPaymentPlans.id, existing.id))
        .returning()
    : await db
        .insert(contractorPaymentPlans)
        .values({
          contractorId: req.body.contractorId,
          productionOrderId: req.body.productionOrderId,
          totalAmount: money(totalAmount),
        })
        .returning();

  const currentLines = await db
    .select()
    .from(contractorPaymentPlanLines)
    .where(eq(contractorPaymentPlanLines.planId, plan.id));

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
    const lineValues = {
      phaseKey: line.phaseKey,
      phaseLabel: line.phaseLabel,
      plannedAmount: money(line.plannedAmount),
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

  const updatedPlans = await hydratePlans();
  res.status(existing ? 200 : 201).json(updatedPlans.find((entry) => entry.id === plan.id) ?? null);
});

router.post('/payments', validate(paymentSchema), async (req, res) => {
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
