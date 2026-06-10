import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';

export const measurementStatusEnum = pgEnum('measurement_status', [
  'scheduled',
  'completed',
  'cancelled',
]);

export const measurements = pgTable('measurements', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  date: date('date').notNull(),
  time: varchar('time', { length: 10 }).notNull(),
  address: text('address').notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  referenceNotes: text('reference_notes'),
  furnitureItems: text('furniture_items').array().notNull(),
  quotationDeliveryDate: date('quotation_delivery_date'),
  prequotationLink: text('prequotation_link'),
  notes: text('notes'),
  status: measurementStatusEnum('status').notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
