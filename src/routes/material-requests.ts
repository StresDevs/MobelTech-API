import { randomUUID } from 'crypto';
import { Router } from 'express';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
  contractors,
  materialRequestItems,
  materialRequests,
  notifications,
  productionOrders,
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

async function hydrateMaterialRequests(requestRows: typeof materialRequests.$inferSelect[]) {
  if (requestRows.length === 0) return [];

  let itemRows: typeof materialRequestItems.$inferSelect[] = [];

  try {
    itemRows = await db
      .select()
      .from(materialRequestItems)
      .where(inArray(materialRequestItems.materialRequestId, requestRows.map((row) => row.id)))
      .orderBy(asc(materialRequestItems.createdAt));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('material_request_items') || !message.includes('does not exist')) {
      throw error;
    }
  }

  return requestRows.map((request) => ({
    ...request,
    items: itemRows.filter((item) => item.materialRequestId === request.id),
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
