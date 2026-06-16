import { Router } from 'express';
import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { notifications } from '../db/schema';
import { validate } from '../middleware/validate';

const router = Router();

const createNotificationSchema = z.object({
  recipientUserId: z.string().uuid(),
  message: z.string().min(1),
  relatedJobId: z.string().uuid().optional().nullable(),
});

const updateNotificationSchema = z.object({
  read: z.boolean().optional(),
});

router.get('/', async (req, res) => {
  const recipientUserId = req.query.recipientUserId as string | undefined;
  const unreadOnly = req.query.unreadOnly === 'true';

  const filters = [
    recipientUserId ? eq(notifications.recipientUserId, recipientUserId) : undefined,
    unreadOnly ? eq(notifications.read, false) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(notifications)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(notifications.createdAt));

  res.json(rows);
});

router.post('/', validate(createNotificationSchema), async (req, res) => {
  const [created] = await db
    .insert(notifications)
    .values({
      id: randomUUID(),
      recipientUserId: req.body.recipientUserId,
      message: req.body.message,
      relatedJobId: req.body.relatedJobId ?? null,
    })
    .returning();

  res.status(201).json(created);
});

router.put('/:id', validate(updateNotificationSchema), async (req, res) => {
  const [updated] = await db
    .update(notifications)
    .set({
      ...req.body,
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, req.params.id as string))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  res.json(updated);
});

export default router;
