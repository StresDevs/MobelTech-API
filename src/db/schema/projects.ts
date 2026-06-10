import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';

export const projectStatusEnum = pgEnum('project_status', [
  'quotation',
  'production',
  'delivered',
]);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  status: projectStatusEnum('status').notNull().default('quotation'),
  startDate: date('start_date').notNull(),
  estimatedDeliveryDate: date('estimated_delivery_date').notNull(),
  actualDeliveryDate: date('actual_delivery_date'),
  budget: numeric('budget', { precision: 12, scale: 2 }).notNull().default('0'),
  totalRevenue: numeric('total_revenue', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
