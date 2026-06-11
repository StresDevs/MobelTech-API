import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { contractors } from '../db/schema';
import { eq } from 'drizzle-orm';
import { validate } from '../middleware/validate';

const router = Router();

const contractorSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(1).max(50),
  email: z.string().email().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  specialization: z.string().optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
  advance1: z.union([z.number(), z.string()]).optional().nullable(),
  advance2: z.union([z.number(), z.string()]).optional().nullable(),
  advance3: z.union([z.number(), z.string()]).optional().nullable(),
  balance: z.union([z.number(), z.string()]).optional().nullable(),
});

const updateContractorSchema = contractorSchema.partial();

router.get('/', async (_req, res) => {
  const result = await db.select().from(contractors).orderBy(contractors.createdAt);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(contractors).where(eq(contractors.id, req.params.id as string));
  if (!row) return res.status(404).json({ error: 'Contractor not found' });
  res.json(row);
});

router.post('/', validate(contractorSchema), async (req, res) => {
  const [row] = await db.insert(contractors).values({
    ...req.body,
    advance1: req.body.advance1 != null ? String(req.body.advance1) : '0',
    advance2: req.body.advance2 != null ? String(req.body.advance2) : null,
    advance3: req.body.advance3 != null ? String(req.body.advance3) : null,
    balance: req.body.balance != null ? String(req.body.balance) : '0',
  }).returning();
  res.status(201).json(row);
});

router.put('/:id', validate(updateContractorSchema), async (req, res) => {
  const [row] = await db.update(contractors).set({
    ...req.body,
    advance1: req.body.advance1 != null ? String(req.body.advance1) : undefined,
    advance2: req.body.advance2 != null ? String(req.body.advance2) : undefined,
    advance3: req.body.advance3 != null ? String(req.body.advance3) : undefined,
    balance: req.body.balance != null ? String(req.body.balance) : undefined,
    updatedAt: new Date(),
  }).where(eq(contractors.id, req.params.id as string)).returning();
  if (!row) return res.status(404).json({ error: 'Contractor not found' });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(contractors).where(eq(contractors.id, req.params.id as string)).returning();
  if (!row) return res.status(404).json({ error: 'Contractor not found' });
  res.json({ message: 'Contractor deleted' });
});

export default router;
