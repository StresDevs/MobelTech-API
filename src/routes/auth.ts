import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { users } from '../db/schema';
import { eq, or } from 'drizzle-orm';
import { createToken, getTokenFromRequestCookie, serializeAuthCookie, verifyToken } from '../lib/auth';
import { validate } from '../middleware/validate';

const router = Router();

const loginSchema = z.object({
  identifier: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(8).max(100),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid credentials payload' });
    return;
  }

  const password = parsed.data.password;
  const rawIdentifier = (parsed.data.identifier ?? parsed.data.email ?? '').toLowerCase().trim();
  const normalizedUsername = rawIdentifier.replace(/^@+/, '');
  const normalizedEmail = rawIdentifier.includes('@')
    ? rawIdentifier
    : `${normalizedUsername}@mobeltech.local`;

  const [user] = await db.select().from(users).where(
    or(
      eq(users.username, normalizedUsername),
      eq(users.email, normalizedEmail),
    ),
  );
  if (!user || user.passwordHash !== password) {
    res.status(401).json({ error: 'Invalid username/email or password' });
    return;
  }

  const payload = {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    mustChangePassword: user.mustChangePassword,
  } as const;

  const token = createToken(payload);
  res.setHeader('Set-Cookie', serializeAuthCookie(token));
  res.json({
    user: {
      ...payload,
      status: user.status,
    },
    token,
  });
});

router.get('/me', async (req, res) => {
  const token = getTokenFromRequestCookie(req.headers.cookie);
  const auth = verifyToken(token);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, auth.id));
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      mustChangePassword: user.mustChangePassword,
      status: user.status,
    },
  });
});

router.post('/change-password', validate(changePasswordSchema), async (req, res) => {
  const token = getTokenFromRequestCookie(req.headers.cookie);
  const auth = verifyToken(token);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, auth.id));
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const newPassword = req.body.newPassword.trim();
  if (newPassword === user.passwordHash) {
    res.status(400).json({
      error: 'La nueva contraseña no puede ser igual a la temporal',
    });
    return;
  }

  const [updated] = await db
    .update(users)
    .set({
      passwordHash: newPassword,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  if (!updated) {
    res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
    return;
  }

  res.json({
    user: {
      id: updated.id,
      name: updated.name,
      username: updated.username,
      email: updated.email,
      role: updated.role,
      avatar: updated.avatar,
      mustChangePassword: updated.mustChangePassword,
      status: updated.status,
    },
  });
});

router.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'mobeltech_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

export default router;
