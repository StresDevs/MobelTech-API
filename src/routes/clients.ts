import { Router, Request, Response } from 'express';
import { db } from '../db';
import { clients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(1).max(50),
  email: z.string().email().optional().nullable(),
  address: z.string().min(1),
  status: z.enum(['active', 'inactive']).optional(),
});

const updateClientSchema = createClientSchema.partial();

// GET /api/clients
router.get('/', async (_req: Request, res: Response) => {
  const result = await db.select().from(clients).orderBy(clients.createdAt);
  res.json(result);
});

// GET /api/clients/:id
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id));
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json(client);
});

// POST /api/clients
router.post('/', validate(createClientSchema), async (req: Request, res: Response) => {
  const [client] = await db.insert(clients).values(req.body).returning();
  res.status(201).json(client);
});

// PUT /api/clients/:id
router.put('/:id', validate(updateClientSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [client] = await db
    .update(clients)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(clients.id, id))
    .returning();
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json(client);
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [client] = await db
    .delete(clients)
    .where(eq(clients.id, id))
    .returning();
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json({ message: 'Client deleted' });
});

export default router;
