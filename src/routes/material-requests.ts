import { randomUUID } from 'crypto';
import { Router } from 'express';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  contractors,
  materialRequestItemAdjustments,
  materialRequestItems,
  materialRequests,
  notifications,
  productionOrders,
  projects,
  users,
} from '../db/schema';
import { validate } from '../middleware/validate';

const router = Router();

const requestItemSchema = z.object({
  materialId: z.string().uuid(),
  quantity: z.number().int().positive(),
  notes: z.string().optional().nullable(),
});

const createMaterialRequestSchema = z.object({
  contractorId: z.string().uuid(),
  productionOrderId: z.string().uuid().optional().nullable(),
  submittedByUserId: z.string().optional().nullable(),
  items: z.array(requestItemSchema).min(1),
});

const updateMaterialRequestStatusSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  rejectionComments: z.string().optional().nullable(),
  adminNotes: z.string().optional().nullable(),
  reviewedByUserId: z.string().optional().nullable(),
});

const updateMaterialRequestItemsSchema = z.object({
  contractorId: z.string().uuid(),
  changedByUserId: z.string().optional().nullable(),
  items: z.array(z.object({
    id: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
});

async function hydrateMaterialRequests(requestRows: typeof materialRequests.$inferSelect[]) {
  if (requestRows.length === 0) return [];

  let itemRows: typeof materialRequestItems.$inferSelect[] = [];
  let adjustmentRows: typeof materialRequestItemAdjustments.$inferSelect[] = [];

  try {
    itemRows = await db
      .select()
      .from(materialRequestItems)
      .where(inArray(materialRequestItems.materialRequestId, requestRows.map((row) => row.id)))
      .orderBy(asc(materialRequestItems.createdAt));

    adjustmentRows = await db
      .select()
      .from(materialRequestItemAdjustments)
      .where(inArray(materialRequestItemAdjustments.materialRequestId, requestRows.map((row) => row.id)))
      .orderBy(desc(materialRequestItemAdjustments.createdAt));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const missingMaterialRequestTable = (
      message.includes('material_request_items') ||
      message.includes('material_request_item_adjustments')
    ) && message.includes('does not exist');
    if (!missingMaterialRequestTable) {
      throw error;
    }
  }

  return requestRows.map((request) => ({
    ...request,
    items: itemRows.filter((item) => item.materialRequestId === request.id),
    adjustments: adjustmentRows.filter((adjustment) => adjustment.materialRequestId === request.id),
  }));
}

async function getOperationsRecipients() {
  return db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.role, 'admin'), eq(users.role, 'architect')));
}

router.get('/', async (req, res) => {
  const contractorId = String(req.query.contractorId ?? '').trim();
  const status = String(req.query.status ?? '').trim();

  if (contractorId && !UUID_REGEX.test(contractorId)) {
    res.json([]);
    return;
  }

  const filters = [
    contractorId ? eq(materialRequests.contractorId, contractorId) : undefined,
    status ? eq(materialRequests.status, status as 'pending' | 'approved' | 'rejected') : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(materialRequests)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(materialRequests.requestDate));

  res.json(await hydrateMaterialRequests(rows));
});

router.post('/', validate(createMaterialRequestSchema), async (req, res) => {
  const { contractorId, items, productionOrderId, submittedByUserId } = req.body;

  const [contractor] = await db
    .select()
    .from(contractors)
    .where(eq(contractors.id, contractorId));

  if (!contractor) {
    res.status(404).json({ error: 'Contractor not found' });
    return;
  }

  if (productionOrderId) {
    const [order] = await db
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(eq(productionOrders.id, productionOrderId));

    if (!order) {
      res.status(404).json({ error: 'Production order not found' });
      return;
    }
  }

  const [created] = await db
    .insert(materialRequests)
    .values({
      id: randomUUID(),
      contractorId,
      productionOrderId: productionOrderId ?? null,
      submittedByUserId: submittedByUserId && UUID_REGEX.test(submittedByUserId) ? submittedByUserId : null,
      status: 'pending',
    })
    .returning();

  await db.insert(materialRequestItems).values(
    items.map((item: z.infer<typeof requestItemSchema>) => ({
      id: randomUUID(),
      materialRequestId: created.id,
      materialId: item.materialId,
      quantity: item.quantity,
      notes: item.notes?.trim() || null,
    })),
  );

  const adminUsers = await getOperationsRecipients();

  if (adminUsers.length > 0) {
    await db.insert(notifications).values(
      adminUsers.map((user) => ({
        id: randomUUID(),
        recipientUserId: user.id,
        message: `Nueva solicitud de materiales de ${contractor.name}.`,
        relatedJobId: productionOrderId ?? null,
      })),
    );
  }

  const [hydrated] = await hydrateMaterialRequests([created]);
  res.status(201).json(hydrated);
});

router.patch('/:id/items', validate(updateMaterialRequestItemsSchema), async (req, res) => {
  const requestId = req.params.id as string;
  const { contractorId, changedByUserId, items } = req.body;

  const [existing] = await db
    .select()
    .from(materialRequests)
    .where(eq(materialRequests.id, requestId));

  if (!existing) {
    res.status(404).json({ error: 'Material request not found' });
    return;
  }

  if (existing.contractorId !== contractorId) {
    res.status(403).json({ error: 'No puedes modificar una solicitud de otro contratista.' });
    return;
  }

  if (existing.status !== 'approved') {
    res.status(409).json({ error: 'Solo puedes reajustar solicitudes aprobadas.' });
    return;
  }

  if (!existing.productionOrderId) {
    res.status(409).json({ error: 'La solicitud no está vinculada a un trabajo vigente.' });
    return;
  }

  const [order] = await db
    .select()
    .from(productionOrders)
    .where(eq(productionOrders.id, existing.productionOrderId));

  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }

  if (order.status === 'completed') {
    res.status(409).json({ error: 'No puedes reajustar solicitudes de trabajos entregados.' });
    return;
  }

  if (order.projectId) {
    const [project] = await db
      .select({ status: projects.status })
      .from(projects)
      .where(eq(projects.id, order.projectId));

    if (project?.status === 'delivered') {
      res.status(409).json({ error: 'No puedes reajustar solicitudes de proyectos entregados.' });
      return;
    }
  }

  const currentItems = await db
    .select()
    .from(materialRequestItems)
    .where(eq(materialRequestItems.materialRequestId, requestId));

  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const changes: Array<{
    item: typeof currentItems[number];
    nextQuantity: number;
  }> = [];

  for (const submittedItem of items as Array<z.infer<typeof updateMaterialRequestItemsSchema>['items'][number]>) {
    const current = currentById.get(submittedItem.id);
    if (!current) {
      res.status(400).json({ error: 'La solicitud contiene un material que no pertenece a este registro.' });
      return;
    }

    if (current.quantity !== submittedItem.quantity) {
      changes.push({ item: current, nextQuantity: submittedItem.quantity });
    }
  }

  if (changes.length === 0) {
    const [hydrated] = await hydrateMaterialRequests([existing]);
    res.json(hydrated);
    return;
  }

  const normalizedChangedBy = changedByUserId && UUID_REGEX.test(changedByUserId) ? changedByUserId : null;

  for (const change of changes) {
    await db
      .update(materialRequestItems)
      .set({ quantity: change.nextQuantity })
      .where(eq(materialRequestItems.id, change.item.id));
  }

  await db.insert(materialRequestItemAdjustments).values(
    changes.map((change) => ({
      id: randomUUID(),
      materialRequestId: requestId,
      materialRequestItemId: change.item.id,
      materialId: change.item.materialId,
      previousQuantity: change.item.quantity,
      newQuantity: change.nextQuantity,
      note: `Cantidad reajustada de ${change.item.quantity} a ${change.nextQuantity}.`,
      changedByUserId: normalizedChangedBy,
    })),
  );

  const [updated] = await db
    .update(materialRequests)
    .set({ updatedAt: new Date() })
    .where(eq(materialRequests.id, requestId))
    .returning();

  const [contractor] = await db
    .select()
    .from(contractors)
    .where(eq(contractors.id, contractorId));

  const adminUsers = await getOperationsRecipients();
  if (adminUsers.length > 0) {
    await db.insert(notifications).values(
      adminUsers.map((user) => ({
        id: randomUUID(),
        recipientUserId: user.id,
        message: `${contractor?.name ?? 'Un contratista'} reajustó cantidades de una solicitud de materiales aprobada.`,
        relatedJobId: existing.productionOrderId,
      })),
    );
  }

  const [hydrated] = await hydrateMaterialRequests([updated]);
  res.json(hydrated);
});

router.patch('/:id/status', validate(updateMaterialRequestStatusSchema), async (req, res) => {
  const requestId = req.params.id as string;
  const { status, rejectionComments, adminNotes, reviewedByUserId } = req.body;

  if (status === 'rejected' && !rejectionComments?.trim()) {
    res.status(400).json({ error: 'Debes explicar el motivo del rechazo.' });
    return;
  }

  const [existing] = await db
    .select()
    .from(materialRequests)
    .where(eq(materialRequests.id, requestId));

  if (!existing) {
    res.status(404).json({ error: 'Material request not found' });
    return;
  }

  const [updated] = await db
    .update(materialRequests)
    .set({
      status,
      rejectionComments: status === 'rejected' ? rejectionComments?.trim() ?? null : null,
      adminNotes: adminNotes?.trim() || null,
      reviewedByUserId: reviewedByUserId && UUID_REGEX.test(reviewedByUserId) ? reviewedByUserId : null,
      updatedAt: new Date(),
    })
    .where(eq(materialRequests.id, requestId))
    .returning();

  const [contractor] = await db
    .select()
    .from(contractors)
    .where(eq(contractors.id, updated.contractorId));

  if (contractor?.userId) {
    await db.insert(notifications).values({
      id: randomUUID(),
      recipientUserId: contractor.userId,
      message:
        status === 'approved'
          ? 'Tu solicitud de materiales fue aprobada.'
          : `Tu solicitud de materiales fue rechazada: ${rejectionComments?.trim()}`,
      relatedJobId: updated.productionOrderId ?? null,
    });
  }

  const [hydrated] = await hydrateMaterialRequests([updated]);
  res.json(hydrated);
});

export default router;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
