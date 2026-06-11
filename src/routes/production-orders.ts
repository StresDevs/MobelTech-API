import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { productionItems, productionItemPhases, productionOrders } from '../db/schema';

const router = Router();

async function hydrateProductionOrder(orderId: string) {
  const [order] = await db.select().from(productionOrders).where(eq(productionOrders.id, orderId));
  if (!order) return null;

  const items = await db.select().from(productionItems).where(eq(productionItems.productionOrderId, orderId));
  const hydratedItems = await Promise.all(
    items.map(async (item) => {
      const phases = await db
        .select()
        .from(productionItemPhases)
        .where(eq(productionItemPhases.productionItemId, item.id));
      return { ...item, phases };
    }),
  );

  return { ...order, items: hydratedItems };
}

router.get('/', async (req, res) => {
  const contractorId = req.query.contractorId as string | undefined;
  const rows = await db.select().from(productionOrders).orderBy(desc(productionOrders.createdAt));
  const filtered = contractorId ? rows.filter((r) => r.assignedContractorId === contractorId) : rows;
  const hydrated = await Promise.all(filtered.map((row) => hydrateProductionOrder(row.id)));
  res.json(hydrated.filter(Boolean));
});

router.get('/:id', async (req, res) => {
  const order = await hydrateProductionOrder(req.params.id as string);
  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }
  res.json(order);
});

export default router;
