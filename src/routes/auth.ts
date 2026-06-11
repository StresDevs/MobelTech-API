import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createToken, getTokenFromRequestCookie, serializeAuthCookie, verifyToken } from '../lib/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid credentials payload' });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
  if (!user || user.passwordHash !== password) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
  } as const;

  const token = createToken(payload);
  res.setHeader('Set-Cookie', serializeAuthCookie(token));
  res.json({ user: payload, token });
});

router.get('/me', async (req, res) => {
  const token = getTokenFromRequestCookie(req.headers.cookie);
  const auth = verifyToken(token);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ user: auth });
});

router.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'mobeltech_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

export default router;
