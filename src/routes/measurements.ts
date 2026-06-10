import { Router, Request, Response } from 'express';
import { db } from '../db';
import { measurements } from '../db/schema';
import { eq } from 'drizzle-orm';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

const createMeasurementSchema = z.object({
  clientId: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD
  time: z.string().max(10),
  address: z.string().min(1),
  phone: z.string().min(1).max(50),
  referenceNotes: z.string().optional().nullable(),
  furnitureItems: z.array(z.string()).min(1),
  quotationDeliveryDate: z.string().optional().nullable(),
  prequotationLink: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
});

const updateMeasurementSchema = createMeasurementSchema.partial();

// GET /api/measurements
router.get('/', async (_req: Request, res: Response) => {
  const result = await db.select().from(measurements).orderBy(measurements.date);
  res.json(result);
});

// GET /api/measurements/:id
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [measurement] = await db
    .select()
    .from(measurements)
    .where(eq(measurements.id, id));
  if (!measurement) {
    res.status(404).json({ error: 'Measurement not found' });
    return;
  }
  res.json(measurement);
});

// POST /api/measurements
router.post('/', validate(createMeasurementSchema), async (req: Request, res: Response) => {
  const [measurement] = await db.insert(measurements).values(req.body).returning();
  res.status(201).json(measurement);
});

// PUT /api/measurements/:id
router.put('/:id', validate(updateMeasurementSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [measurement] = await db
    .update(measurements)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(measurements.id, id))
    .returning();
  if (!measurement) {
    res.status(404).json({ error: 'Measurement not found' });
    return;
  }
  res.json(measurement);
});

// DELETE /api/measurements/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [measurement] = await db
    .delete(measurements)
    .where(eq(measurements.id, id))
    .returning();
  if (!measurement) {
    res.status(404).json({ error: 'Measurement not found' });
    return;
  }
  res.json({ message: 'Measurement deleted' });
});

export default router;
