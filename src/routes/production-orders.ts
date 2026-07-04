import { Router } from 'express';
import { randomUUID } from 'crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { productionItems, productionItemPhases, productionOrders, productionPhaseMachines, productionSchedulePhases } from '../db/schema';
import { validate } from '../middleware/validate';
import { ensureProductionSchema } from '../db/ensure-production-schema';

const router = Router();

const schedulePhaseSchema = z.object({
  phase: z.enum(['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado']),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  cuttingMachine: z.string().max(80).optional().nullable(),
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

const realProgressSchema = z.object({
  phase: z.enum(['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado']),
  action: z.enum(['start', 'finish']),
  date: z.string().min(1),
  createdBy: z.string().optional().nullable(),
});

const phaseMachineSchema = z.object({
  phase: z.enum(['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado']),
  name: z.string().min(1).max(80),
  active: z.enum(['true', 'false']).optional().default('true'),
  sortOrder: z.number().int().optional().default(0),
});

const PRODUCTION_PHASES = ['cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado'] as const;

function parseDateOnly(value: string) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePhaseMachine(row: typeof productionPhaseMachines.$inferSelect) {
  return {
    ...row,
    active: row.active !== 'false',
  };
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

router.get('/phase-machines', async (req, res) => {
  await ensureProductionSchema();
  const activeOnly = req.query.activeOnly !== 'false';
  const rows = await db
    .select()
    .from(productionPhaseMachines)
    .where(activeOnly ? eq(productionPhaseMachines.active, 'true') : undefined)
    .orderBy(asc(productionPhaseMachines.phase), asc(productionPhaseMachines.sortOrder), asc(productionPhaseMachines.name));

  res.json(rows.map(normalizePhaseMachine));
});

router.post('/phase-machines', validate(phaseMachineSchema), async (req, res) => {
  await ensureProductionSchema();
  const [created] = await db
    .insert(productionPhaseMachines)
    .values({
      phase: req.body.phase,
      name: req.body.name.trim(),
      active: req.body.active ?? 'true',
      sortOrder: req.body.sortOrder ?? 0,
    })
    .returning();

  res.status(201).json(normalizePhaseMachine(created));
});

router.put('/phase-machines/:id', validate(phaseMachineSchema.partial()), async (req, res) => {
  await ensureProductionSchema();
  const [updated] = await db
    .update(productionPhaseMachines)
    .set({
      ...(req.body.phase !== undefined ? { phase: req.body.phase } : {}),
      ...(req.body.name !== undefined ? { name: req.body.name.trim() } : {}),
      ...(req.body.active !== undefined ? { active: req.body.active } : {}),
      ...(req.body.sortOrder !== undefined ? { sortOrder: req.body.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(productionPhaseMachines.id, req.params.id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Máquina de fase no encontrada' });
    return;
  }

  res.json(normalizePhaseMachine(updated));
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

  const tentativeStart = parseDateOnly(String(order.startDate));
  const tentativeEnd = parseDateOnly(String(order.estimatedDeliveryDate));
  const machineRows = await db
    .select()
    .from(productionPhaseMachines)
    .where(eq(productionPhaseMachines.active, 'true'));

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

    if (type === 'actual' && tentativeStart && tentativeEnd && (start < tentativeStart || end > tentativeEnd)) {
      res.status(400).json({
        error: `La fase ${phase.phase} debe estar dentro del cronograma tentativo (${order.startDate} - ${order.estimatedDeliveryDate}).`,
      });
      return;
    }

    const phaseMachines = machineRows.filter((machine) => machine.phase === phase.phase);
    if (type === 'actual' && phaseMachines.length > 0) {
      if (!phase.cuttingMachine) {
        res.status(400).json({ error: `Selecciona una máquina para la fase ${phase.phase}.` });
        return;
      }
      const selectedMachine = phaseMachines.find((machine) => (
        machine.id === phase.cuttingMachine ||
        machine.name.toLowerCase() === String(phase.cuttingMachine).toLowerCase()
      ));
      if (!selectedMachine) {
        res.status(400).json({ error: `La máquina seleccionada no pertenece a la fase ${phase.phase}.` });
        return;
      }
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
      cuttingMachine: phase.cuttingMachine ?? null,
      createdBy: normalizedCreatedBy,
      updatedAt: new Date(),
    })),
  );

  const hydrated = await hydrateProductionOrder(order);
  res.json(hydrated);
});

router.patch('/:id/real-progress', validate(realProgressSchema), async (req, res) => {
  await ensureProductionSchema();
  const orderId = req.params.id as string;
  const { phase, action, date, createdBy } = req.body;
  const normalizedCreatedBy = createdBy && UUID_REGEX.test(createdBy) ? createdBy : null;
  const progressDate = parseDateOnly(date);

  if (!progressDate) {
    res.status(400).json({ error: 'La fecha del avance real no es valida.' });
    return;
  }

  const normalizedDate = date.slice(0, 10);
  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId));
  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }

  const [existingRealPhase] = await db
    .select()
    .from(productionSchedulePhases)
    .where(and(
      eq(productionSchedulePhases.productionOrderId, orderId),
      eq(productionSchedulePhases.type, 'real'),
      eq(productionSchedulePhases.phase, phase),
    ));

  if (existingRealPhase) {
    const currentEnd = parseDateOnly(String(existingRealPhase.endDate)) ?? progressDate;
    const nextStartDate = action === 'start' ? normalizedDate : String(existingRealPhase.startDate).slice(0, 10);
    const nextStart = parseDateOnly(nextStartDate) ?? progressDate;

    if (action === 'finish' && progressDate.getTime() < nextStart.getTime()) {
      res.status(400).json({ error: 'La fecha de finalizacion no puede ser anterior al inicio real de la fase.' });
      return;
    }

    await db
      .update(productionSchedulePhases)
      .set({
        startDate: nextStartDate,
        endDate: action === 'finish'
          ? normalizedDate
          : (currentEnd.getTime() < progressDate.getTime() ? normalizedDate : String(existingRealPhase.endDate).slice(0, 10)),
        createdBy: existingRealPhase.createdBy ?? normalizedCreatedBy,
        updatedAt: new Date(),
      })
      .where(eq(productionSchedulePhases.id, existingRealPhase.id));
  } else {
    await db.insert(productionSchedulePhases).values({
      id: randomUUID(),
      productionOrderId: orderId,
      type: 'real',
      phase,
      startDate: normalizedDate,
      endDate: normalizedDate,
      cuttingMachine: null,
      createdBy: normalizedCreatedBy,
      updatedAt: new Date(),
    });
  }

  const items = await db.select().from(productionItems).where(eq(productionItems.productionOrderId, orderId));

  if (action === 'finish') {
    const phaseIndex = PRODUCTION_PHASES.indexOf(phase);
    const progress = Math.round(((phaseIndex + 1) / PRODUCTION_PHASES.length) * 100);

    for (const item of items) {
      await db.update(productionItems).set({
        progress: Math.max(Number(item.progress || 0), progress),
      }).where(eq(productionItems.id, item.id));

      const [existingItemPhase] = await db
        .select()
        .from(productionItemPhases)
        .where(and(
          eq(productionItemPhases.productionItemId, item.id),
          eq(productionItemPhases.phase, phase),
        ));

      if (existingItemPhase) {
        await db.update(productionItemPhases).set({
          completed: 'true',
          completedDate: new Date(`${normalizedDate}T00:00:00`),
        }).where(eq(productionItemPhases.id, existingItemPhase.id));
      } else {
        await db.insert(productionItemPhases).values({
          id: randomUUID(),
          productionItemId: item.id,
          phase,
          completed: 'true',
          completedDate: new Date(`${normalizedDate}T00:00:00`),
        });
      }
    }
  }

  const [updatedOrder] = await db.update(productionOrders).set({
    status: action === 'finish' && phase === 'entregado' ? 'completed' : 'in-progress',
    actualDeliveryDate: action === 'finish' && phase === 'entregado' ? normalizedDate : order.actualDeliveryDate,
    updatedAt: new Date(),
  }).where(eq(productionOrders.id, orderId)).returning();

  const hydrated = await hydrateProductionOrder(updatedOrder);
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
