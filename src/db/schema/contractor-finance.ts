import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { contractors } from './contractors';
import { productionOrders } from './production';

export const contractorPaymentPlans = pgTable('contractor_payment_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractorId: uuid('contractor_id').notNull().references(() => contractors.id, { onDelete: 'cascade' }),
  productionOrderId: uuid('production_order_id').notNull().references(() => productionOrders.id, { onDelete: 'cascade' }),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  reviewStatus: varchar('review_status', { length: 40 }).notNull().default('submitted'),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contractorPaymentPlanLines = pgTable('contractor_payment_plan_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => contractorPaymentPlans.id, { onDelete: 'cascade' }),
  phaseKey: varchar('phase_key', { length: 40 }).notNull(),
  phaseLabel: varchar('phase_label', { length: 120 }).notNull(),
  plannedAmount: numeric('planned_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contractorLaborCatalogItems = pgTable('contractor_labor_catalog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemKey: varchar('item_key', { length: 60 }).notNull(),
  label: varchar('label', { length: 160 }).notNull(),
  defaultAmount: numeric('default_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  active: varchar('active', { length: 5 }).notNull().default('true'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contractorAdvanceRequests = pgTable('contractor_advance_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => contractorPaymentPlans.id, { onDelete: 'cascade' }),
  contractorId: uuid('contractor_id').notNull().references(() => contractors.id, { onDelete: 'cascade' }),
  productionOrderId: uuid('production_order_id').notNull().references(() => productionOrders.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  status: varchar('status', { length: 40 }).notNull().default('submitted'),
  notes: text('notes'),
  reviewNotes: text('review_notes'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contractorPayments = pgTable('contractor_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => contractorPaymentPlans.id, { onDelete: 'cascade' }),
  lineId: uuid('line_id').notNull().references(() => contractorPaymentPlanLines.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  paymentDate: date('payment_date').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
