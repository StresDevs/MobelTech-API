import { Router } from 'express';
import { desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { users } from '../db/schema';
import { validate } from '../middleware/validate';

const router = Router();

const userRoleSchema = z.enum(['admin', 'contractor', 'architect', 'partner']);
const userStatusSchema = z.enum(['active', 'inactive']);

const userBaseSchema = z.object({
  name: z.string().min(1).max(255),
  username: z.string().min(3).max(100),
  role: userRoleSchema,
  status: userStatusSchema.optional(),
  avatar: z.string().optional().nullable(),
});

const createUserSchema = userBaseSchema.extend({
  password: z.string().min(4).max(100).optional().nullable(),
});

const updateUserSchema = userBaseSchema.partial().extend({
  password: z.string().min(4).max(100).optional().nullable(),
});

type DbUser = typeof users.$inferSelect;

function normalizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/^@+/, '');
}

function displayUsername(username: string) {
  const normalized = normalizeUsername(username);
  return `@${normalized}`;
}

function generateTemporaryPassword() {
  return `mt${Math.random().toString(36).slice(2, 6)}${Date.now().toString().slice(-4)}`;
}

function buildEmail(username: string) {
  return `${normalizeUsername(username)}@mobeltech.local`;
}

function sanitizeUser(row: DbUser) {
  return {
    id: row.id,
    name: row.name,
    username: displayUsername(row.username),
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    avatar: row.avatar,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeDbError(err: unknown) {
  if (err && typeof err === 'object') {
    const maybeError = err as { code?: string; message?: string; detail?: string };
    return {
      code: maybeError.code,
      message: maybeError.message ?? 'Database error',
      detail: maybeError.detail,
    };
  }

  return { message: 'Database error' };
}

router.get('/', async (_req, res) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  res.json(rows.map(sanitizeUser));
});

router.get('/:id', async (req, res) => {
  const [row] = await db.select().from(users).where(eq(users.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(sanitizeUser(row));
});

router.post('/', validate(createUserSchema), async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = req.body.password?.trim() || generateTemporaryPassword();
    const email = buildEmail(username);
    const [row] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        name: req.body.name.trim(),
        username,
        email,
        passwordHash: password,
        role: req.body.role,
        status: req.body.status ?? 'active',
        mustChangePassword: true,
        avatar: req.body.avatar ?? null,
      })
      .returning();

    res.status(201).json({
      user: sanitizeUser(row),
      credentials: {
        username: displayUsername(username),
        password,
      },
    });
  } catch (err) {
    const error = serializeDbError(err);
    const message = `${error.message ?? ''} ${error.detail ?? ''}`.toLowerCase();
    if (error.code === '23505' || message.includes('duplicate') || message.includes('unique')) {
      res.status(409).json({
        error: 'Ya existe un usuario con ese username o correo interno.',
        detail: 'Usa otro username antes de guardar.',
      });
      return;
    }

    console.error('❌ Error creating user:', err);
    res.status(500).json({
      error: 'No se pudo crear el usuario',
      detail: error.detail ?? error.message,
    });
  }
});

router.put('/:id', validate(updateUserSchema), async (req, res) => {
  try {
    const updatePayload: Record<string, unknown> = {};

    if (req.body.name !== undefined) updatePayload.name = req.body.name.trim();
    if (req.body.username !== undefined) {
      const normalized = normalizeUsername(req.body.username);
      updatePayload.username = normalized;
      updatePayload.email = buildEmail(normalized);
    }
    if (req.body.role !== undefined) updatePayload.role = req.body.role;
    if (req.body.status !== undefined) updatePayload.status = req.body.status;
    if (req.body.avatar !== undefined) updatePayload.avatar = req.body.avatar;
    if (req.body.password !== undefined && req.body.password !== null) {
      updatePayload.passwordHash = req.body.password.trim();
      updatePayload.mustChangePassword = true;
    }
    updatePayload.updatedAt = new Date();

    const [row] = await db
      .update(users)
      .set(updatePayload)
      .where(eq(users.id, req.params.id as string))
      .returning();

    if (!row) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(sanitizeUser(row));
  } catch (err) {
    const error = serializeDbError(err);
    const message = `${error.message ?? ''} ${error.detail ?? ''}`.toLowerCase();
    if (error.code === '23505' || message.includes('duplicate') || message.includes('unique')) {
      res.status(409).json({
        error: 'Ya existe un usuario con ese username o correo interno.',
        detail: 'Revisa el username antes de actualizar.',
      });
      return;
    }

    console.error('❌ Error updating user:', err);
    res.status(500).json({
      error: 'No se pudo actualizar el usuario',
      detail: error.detail ?? error.message,
    });
  }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const tempPassword = generateTemporaryPassword();
    const [row] = await db
      .update(users)
      .set({
        passwordHash: tempPassword,
        mustChangePassword: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.params.id as string))
      .returning();

    if (!row) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: sanitizeUser(row),
      credentials: {
        username: displayUsername(row.username),
        password: tempPassword,
      },
    });
  } catch (err) {
    console.error('❌ Error resetting user password:', err);
    const error = serializeDbError(err);
    res.status(500).json({
      error: 'No se pudo restablecer la contraseña',
      detail: error.detail ?? error.message,
    });
  }
});

router.delete('/:id', async (req, res) => {
  const [row] = await db.delete(users).where(eq(users.id, req.params.id as string)).returning();
  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ message: 'User deleted' });
});

export default router;
