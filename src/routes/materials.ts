import { Router } from 'express';
import { asc, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { materials } from '../db/schema';

const router = Router();

router.get('/', async (req, res) => {
  const query = String(req.query.q ?? '').trim();

  const rows = await db
    .select()
    .from(materials)
    .where(
      query
        ? or(
            ilike(materials.name, `%${query}%`),
            ilike(materials.unit, `%${query}%`),
          )
        : undefined,
    )
    .orderBy(asc(materials.name));

  res.json(
    rows.map((row) => ({
      ...row,
      unitPrice: Number(row.unitPrice ?? 0),
      stock: Number(row.stock ?? 0),
    })),
  );
});

export default router;
