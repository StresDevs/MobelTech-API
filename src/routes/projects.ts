import { Router, Request, Response } from 'express';
import { db } from '../db';
import { projects } from '../db/schema';
import { eq } from 'drizzle-orm';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  clientId: z.string().uuid(),
  status: z.enum(['quotation', 'production', 'delivered']).optional(),
  startDate: z.string(),
  estimatedDeliveryDate: z.string(),
  actualDeliveryDate: z.string().optional().nullable(),
  budget: z.string().or(z.number()).optional(),
  totalRevenue: z.string().or(z.number()).optional().nullable(),
});

const updateProjectSchema = createProjectSchema.partial();

// GET /api/projects
router.get('/', async (_req: Request, res: Response) => {
  const result = await db.select().from(projects).orderBy(projects.createdAt);
  res.json(result);
});

// GET /api/projects/:id
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// POST /api/projects
router.post('/', validate(createProjectSchema), async (req: Request, res: Response) => {
  const [project] = await db.insert(projects).values(req.body).returning();
  res.status(201).json(project);
});

// PUT /api/projects/:id
router.put('/:id', validate(updateProjectSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [project] = await db
    .update(projects)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// DELETE /api/projects/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [project] = await db
    .delete(projects)
    .where(eq(projects.id, id))
    .returning();
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ message: 'Project deleted' });
});

export default router;
