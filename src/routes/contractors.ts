import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../db';
import { contractors, users } from '../db/schema';
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
  username: z.string().min(3).max(50).optional().nullable(),
  password: z.string().min(4).max(100).optional().nullable(),
  createSystemAccess: z.boolean().optional(),
});

const updateContractorSchema = contractorSchema.partial();

router.get('/', async (_req, res) => {
  const result = await db.select({
    id: contractors.id,
    name: contractors.name,
    phone: contractors.phone,
    email: contractors.email,
    userId: contractors.userId,
    specialization: contractors.specialization,
    status: contractors.status,
  }).from(contractors).orderBy(contractors.name);
  res.json(result);
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(contractors).where(eq(contractors.id, req.params.id as string));
  if (!row) return res.status(404).json({ error: 'Contractor not found' });
  res.json(row);
});

router.post('/', validate(contractorSchema), async (req, res) => {
  try {
  const {
    username,
    password: rawPassword,
    createSystemAccess,
    ...contractorData
  } = req.body;
  const shouldCreateSystemAccess = createSystemAccess !== false;
  const rawUsername = username?.trim().toLowerCase();
  const password = rawPassword?.trim() || generatePassword();

  let linkedUserId = contractorData.userId ?? null;
  let createdCredentials: { username: string; password: string } | null = null;

  if (shouldCreateSystemAccess) {
    const generatedUsername = await generateAvailableUsername(rawUsername || contractorData.name);
    const email = `${generatedUsername}@mobeltech.local`;
    const [user] = await db.insert(users).values({
      id: randomUUID(),
      name: contractorData.name,
      email,
      passwordHash: password,
      role: 'contractor',
    }).returning();

    linkedUserId = user.id;
    createdCredentials = { username: generatedUsername, password };
  }

  const [row] = await db.insert(contractors).values({
    ...contractorData,
    userId: linkedUserId,
    advance1: contractorData.advance1 != null ? String(contractorData.advance1) : '0',
    advance2: contractorData.advance2 != null ? String(contractorData.advance2) : null,
    advance3: contractorData.advance3 != null ? String(contractorData.advance3) : null,
    balance: contractorData.balance != null ? String(contractorData.balance) : '0',
  }).returning();
  res.status(201).json({
    ...row,
    credentials: createdCredentials,
  });
  } catch (err) {
    console.error('❌ Error creating contractor:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message.toLowerCase().includes('users')) {
      res.status(500).json({
        error: 'No se pudo crear el acceso del contratista porque la tabla users no esta lista en la base de datos',
        detail: 'Ejecuta el script ensure-users.sql en Neon y reinicia la API.',
      });
      return;
    }

    res.status(500).json({
      error: 'No se pudo crear el contratista',
      detail: message,
    });
  }
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

function slugifyUsername(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24) || 'contratista';
}

function generatePassword() {
  return `mt${Math.random().toString(36).slice(2, 6)}${Date.now().toString().slice(-4)}`;
}

async function generateAvailableUsername(baseValue: string) {
  const base = slugifyUsername(baseValue);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, `${candidate}@mobeltech.local`));

    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}.${suffix}`;
  }
}
