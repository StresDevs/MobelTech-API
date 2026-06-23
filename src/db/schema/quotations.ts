import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { projects } from './projects';

export const quotationStatusEnum = pgEnum('quotation_status', [
  'draft',
  'adjustment',
  'approved',
  'rejected',
]);

export const quotations = pgTable('quotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  uid: varchar('uid', { length: 24 }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  projectId: uuid('project_id').references(() => projects.id),
  status: quotationStatusEnum('status').notNull().default('draft'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  advanceAmount: numeric('advance_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const quotationItems = pgTable('quotation_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .notNull()
    .references(() => quotations.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  dimensions: varchar('dimensions', { length: 100 }),
  notes: text('notes'),
});
