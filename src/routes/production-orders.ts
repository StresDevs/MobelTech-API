import { Router } from 'express';
import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { productionItems, productionItemPhases, productionOrders, productionSchedulePhases } from '../db/schema';
import { validate } from '../middleware/validate';
import { ensureProductionSchema } from '../db/ensure-production-schema';

const router = Router();

const schedulePhaseSchema = z.object({
  phase: z.enum(['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado']),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  cuttingMachine: z.enum(['cortadora-1', 'cortadora-2']).optional().nullable(),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const updateScheduleSchema = z.object({
  type: z.enum(['tentative', 'actual']),
  createdBy: z.string().optional().nullable(),
  phases: z.array(schedulePhaseSchema).length(5),
});

const progressSchema = z.object({
  phase: z.enum(['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado']),
});

const PRODUCTION_PHASES = ['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado'] as const;

function parseDateOnly(value: string) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function hydrateProductionOrder(order: typeof productionOrders.$inferSelect) {
  const items = await db.select().from(productionItems).where(eq(productionItems.productionOrderId, order.id));
  const schedulePhases = await db
    .select()
    .from(productionSchedulePhases)
    .where(eq(productionSchedulePhases.productionOrderId, order.id));

  const hydratedItems = await Promise.all(
    items.map(async (item) => {
      const phases = await db
        .select()
        .from(productionItemPhases)
        .where(eq(productionItemPhases.productionItemId, item.id));
      return { ...item, phases };
    }),
  );

  return { ...order, items: hydratedItems, schedulePhases };
}

router.get('/', async (req, res) => {
  await ensureProductionSchema();
  const contractorId = req.query.contractorId as string | undefined;
  const rows = await db.select().from(productionOrders).orderBy(desc(productionOrders.createdAt));
  const filtered = contractorId ? rows.filter((r) => r.assignedContractorId === contractorId) : rows;
  const hydrated = await Promise.all(filtered.map((row) => hydrateProductionOrder(row)));
  res.json(hydrated.filter(Boolean));
});

router.get('/:id', async (req, res) => {
  await ensureProductionSchema();
  const [row] = await db.select().from(productionOrders).where(eq(productionOrders.id, req.params.id as string));
  if (!row) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }
  const order = await hydrateProductionOrder(row);
  res.json(order);
});

router.put('/:id/schedule', validate(updateScheduleSchema), async (req, res) => {
  await ensureProductionSchema();
  const orderId = req.params.id as string;
  const { type, phases, createdBy } = req.body;
  const normalizedCreatedBy = createdBy && UUID_REGEX.test(createdBy) ? createdBy : null;

  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId));
  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }

  for (const phase of phases as Array<z.infer<typeof schedulePhaseSchema>>) {
    const start = parseDateOnly(phase.startDate);
    const end = parseDateOnly(phase.endDate);

    if (!start || !end) {
      res.status(400).json({ error: 'Cada fase debe tener fechas validas.' });
      return;
    }

    if (end.getTime() < start.getTime()) {
      res.status(400).json({ error: 'La fecha final de una fase no puede ser anterior a su inicio.' });
      return;
    }
  }

  await db
    .delete(productionSchedulePhases)
    .where(and(
      eq(productionSchedulePhases.productionOrderId, orderId),
      eq(productionSchedulePhases.type, type),
    ));

  await db.insert(productionSchedulePhases).values(
    phases.map((phase: z.infer<typeof schedulePhaseSchema>) => ({
      id: randomUUID(),
      productionOrderId: orderId,
      type,
      phase: phase.phase,
      startDate: phase.startDate,
      endDate: phase.endDate,
      cuttingMachine: phase.phase === 'cortado' ? phase.cuttingMachine ?? null : null,
      createdBy: normalizedCreatedBy,
      updatedAt: new Date(),
    })),
  );

  const hydrated = await hydrateProductionOrder(order);
  res.json(hydrated);
});

router.patch('/:id/progress', validate(progressSchema), async (req, res) => {
  await ensureProductionSchema();
  const orderId = req.params.id as string;
  const phaseIndex = PRODUCTION_PHASES.indexOf(req.body.phase);
  const progress = Math.round(((phaseIndex + 1) / PRODUCTION_PHASES.length) * 100);

  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId));
  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }

  const items = await db.select().from(productionItems).where(eq(productionItems.productionOrderId, orderId));

  for (const item of items) {
    await db.update(productionItems).set({
      progress,
    }).where(eq(productionItems.id, item.id));

    for (const phase of PRODUCTION_PHASES) {
      await db.update(productionItemPhases).set({
        completed: PRODUCTION_PHASES.indexOf(phase) <= phaseIndex ? 'true' : 'false',
        completedDate: PRODUCTION_PHASES.indexOf(phase) <= phaseIndex ? new Date() : null,
      }).where(and(
        eq(productionItemPhases.productionItemId, item.id),
        eq(productionItemPhases.phase, phase),
      ));
    }
  }

  const [updatedOrder] = await db.update(productionOrders).set({
    status: req.body.phase === 'entregado' ? 'completed' : 'in-progress',
    actualDeliveryDate: req.body.phase === 'entregado' ? new Date().toISOString().slice(0, 10) : order.actualDeliveryDate,
    updatedAt: new Date(),
  }).where(eq(productionOrders.id, orderId)).returning();

  const hydrated = await hydrateProductionOrder(updatedOrder);
  res.json(hydrated);
});

export default router;
