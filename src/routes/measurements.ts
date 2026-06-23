import { Router, Request, Response } from 'express';
import { db } from '../db';
import { measurements, prequotations } from '../db/schema';
import { desc, eq } from 'drizzle-orm';
import { validate } from '../middleware/validate';
import { z } from 'zod';

const router = Router();
const BUSINESS_TIMEZONE_OFFSET = '-04:00';
const BUSINESS_TIMEZONE = 'America/La_Paz';
type MeasurementStatus = 'scheduled' | 'completed' | 'cancelled';

function normalizeDateInput(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimeInput(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '';

  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);
  const second = Number.parseInt(match[3] ?? '00', 10);

  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function parseBusinessAppointment(date: string, time: string) {
  const normalizedDate = normalizeDateInput(date);
  const normalizedTime = normalizeTimeInput(time);
  return new Date(`${normalizedDate}T${normalizedTime}${BUSINESS_TIMEZONE_OFFSET}`);
}

function normalizeFurnitureItemsInput(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeOptionalTextInput(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getBusinessCalendarKey(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

function isPastBusinessDate(date: string) {
  const normalizedDate = normalizeDateInput(date);
  if (!normalizedDate) return true;

  return normalizedDate < getBusinessCalendarKey(new Date());
}

function normalizeMeasurementPayload(body: Record<string, unknown>) {
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
  const status: MeasurementStatus =
    body.status === 'completed' || body.status === 'cancelled' || body.status === 'scheduled'
      ? body.status
      : 'scheduled';

  return {
    ...body,
    clientId,
    date: normalizeDateInput(body.date),
    time: normalizeTimeInput(body.time),
    address: typeof body.address === 'string' ? body.address.trim() : '',
    phone: typeof body.phone === 'string' ? body.phone.trim() : '',
    referenceNotes: normalizeOptionalTextInput(body.referenceNotes),
    furnitureItems: normalizeFurnitureItemsInput(body.furnitureItems),
    quotationDeliveryDate: normalizeOptionalTextInput(body.quotationDeliveryDate),
    prequotationLink: normalizeOptionalTextInput(body.prequotationLink),
    notes: normalizeOptionalTextInput(body.notes),
    status,
  };
}

const baseMeasurementSchema = z.object({
  clientId: z.string().uuid(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().trim().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
  address: z.string().trim().min(1),
  phone: z.string().trim().min(1).max(50),
  referenceNotes: z.string().optional().nullable(),
  furnitureItems: z.array(z.string()).min(1),
  quotationDeliveryDate: z.string().optional().nullable(),
  prequotationLink: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
});

const createMeasurementSchema = baseMeasurementSchema.superRefine((data, ctx) => {
  const appointment = parseBusinessAppointment(data.date, data.time);
  if (Number.isNaN(appointment.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid measurement date or time',
      path: ['date'],
    });
    return;
  }

  if (isPastBusinessDate(data.date)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Measurement appointments cannot be scheduled on a past date',
      path: ['date'],
    });
  }
});

const updateMeasurementSchema = baseMeasurementSchema.partial().superRefine((data, ctx) => {
  if (data.date && data.time) {
    const appointment = parseBusinessAppointment(data.date, data.time);
    if (Number.isNaN(appointment.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid measurement date or time',
        path: ['date'],
      });
      return;
    }

    if (isPastBusinessDate(data.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Measurement appointments cannot be scheduled on a past date',
        path: ['date'],
      });
    }
  }
});

async function getLinkedPrequotationsByMeasurementId(measurementIds: string[]) {
  if (measurementIds.length === 0) return new Map<string, { id: string; title: string; status: string }>();

  const rows = await db
    .select({
      id: prequotations.id,
      title: prequotations.title,
      status: prequotations.status,
      measurementId: prequotations.measurementId,
      updatedAt: prequotations.updatedAt,
    })
    .from(prequotations)
    .orderBy(desc(prequotations.updatedAt));

  const linked = new Map<string, { id: string; title: string; status: string }>();
  rows.forEach((prequotation) => {
    if (!prequotation.measurementId || !measurementIds.includes(prequotation.measurementId)) return;
    if (linked.has(prequotation.measurementId)) return;

    linked.set(prequotation.measurementId, {
      id: prequotation.id,
      title: prequotation.title,
      status: prequotation.status,
    });
  });

  return linked;
}

async function hydrateMeasurementLinks<T extends { id: string }>(rows: T[]) {
  const linkedByMeasurementId = await getLinkedPrequotationsByMeasurementId(rows.map((row) => row.id));
  return rows.map((measurement) => ({
    ...measurement,
    linkedPrequotation: linkedByMeasurementId.get(measurement.id) ?? null,
  }));
}

// GET /api/measurements
router.get('/', async (_req: Request, res: Response) => {
  const result = await db
    .select()
    .from(measurements)
    .orderBy(measurements.date, measurements.time);
  res.json(await hydrateMeasurementLinks(result));
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
  const [hydrated] = await hydrateMeasurementLinks([measurement]);
  res.json(hydrated);
});

// POST /api/measurements
router.post('/', validate(createMeasurementSchema), async (req: Request, res: Response) => {
  const normalized = normalizeMeasurementPayload(req.body as Record<string, unknown>);
  const payload = {
    clientId: req.body.clientId as string,
    date: normalized.date,
    time: normalized.time,
    address: normalized.address,
    phone: normalized.phone,
    referenceNotes: normalized.referenceNotes,
    furnitureItems: normalized.furnitureItems,
    quotationDeliveryDate: normalized.quotationDeliveryDate,
    prequotationLink: normalized.prequotationLink,
    notes: normalized.notes,
    status: normalized.status,
  };

  const [measurement] = await db.insert(measurements).values(payload).returning();
  res.status(201).json(measurement);
});

// PUT /api/measurements/:id
router.put('/:id', validate(updateMeasurementSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const normalized = normalizeMeasurementPayload(req.body as Record<string, unknown>);
  const payload: Record<string, unknown> = {};

  if (req.body.clientId !== undefined && normalized.clientId) payload.clientId = normalized.clientId;
  if (req.body.date !== undefined) payload.date = normalized.date;
  if (req.body.time !== undefined) payload.time = normalized.time;
  if (req.body.address !== undefined) payload.address = normalized.address;
  if (req.body.phone !== undefined) payload.phone = normalized.phone;
  if (req.body.referenceNotes !== undefined) payload.referenceNotes = normalized.referenceNotes;
  if (req.body.furnitureItems !== undefined) payload.furnitureItems = normalized.furnitureItems;
  if (req.body.quotationDeliveryDate !== undefined) payload.quotationDeliveryDate = normalized.quotationDeliveryDate;
  if (req.body.prequotationLink !== undefined) payload.prequotationLink = normalized.prequotationLink;
  if (req.body.notes !== undefined) payload.notes = normalized.notes;
  if (req.body.status !== undefined) payload.status = normalized.status;

  const [measurement] = await db
    .update(measurements)
    .set({ ...payload, updatedAt: new Date() })
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
