import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { appPreferences } from '../db/schema';
import { validate } from '../middleware/validate';

const router = Router();

const preferenceValueSchema = z.object({
  value: z.record(z.string(), z.unknown()),
});

router.get('/:key', async (req, res) => {
  const [preference] = await db
    .select()
    .from(appPreferences)
    .where(eq(appPreferences.key, req.params.key as string));

  res.json({
    key: req.params.key,
    value: preference?.value ?? null,
  });
});

router.put('/:key', validate(preferenceValueSchema), async (req, res) => {
  const key = req.params.key as string;
  const value = req.body.value;

  const [saved] = await db
    .insert(appPreferences)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appPreferences.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json(saved);
});

export default router;
