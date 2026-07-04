import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  integer,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { quotations } from './quotations';
import { contractors } from './contractors';

export const productionStatusEnum = pgEnum('production_status', [
  'pending',
  'in-progress',
  'delayed',
  'completed',
]);

export const productionPhaseEnum = pgEnum('production_phase', [
  'cortado',
  'canteado',
  'ensamblado',
  'instalacion',
  'entregado',
]);

export const productionScheduleTypeEnum = pgEnum('production_schedule_type', [
  'tentative',
  'actual',
]);

export const productionOrders = pgTable('production_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  quotationId: uuid('quotation_id').references(() => quotations.id),
  assignedContractorId: uuid('assigned_contractor_id').references(
    () => contractors.id,
  ),
  status: productionStatusEnum('status').notNull().default('pending'),
  startDate: date('start_date').notNull(),
  estimatedDeliveryDate: date('estimated_delivery_date').notNull(),
  actualDeliveryDate: date('actual_delivery_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productionItems = pgTable('production_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionOrderId: uuid('production_order_id')
    .notNull()
    .references(() => productionOrders.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  progress: integer('progress').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productionItemPhases = pgTable('production_item_phases', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionItemId: uuid('production_item_id')
    .notNull()
    .references(() => productionItems.id, { onDelete: 'cascade' }),
  phase: productionPhaseEnum('phase').notNull(),
  completed: varchar('completed', { length: 5 }).notNull().default('false'),
  completedDate: timestamp('completed_date', { withTimezone: true }),
});

export const productionSchedulePhases = pgTable('production_schedule_phases', {
  id: uuid('id').primaryKey().defaultRandom(),
  productionOrderId: uuid('production_order_id')
    .notNull()
    .references(() => productionOrders.id, { onDelete: 'cascade' }),
  type: productionScheduleTypeEnum('type').notNull(),
  phase: productionPhaseEnum('phase').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  cuttingMachine: varchar('cutting_machine', { length: 80 }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productionPhaseMachines = pgTable('production_phase_machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  phase: productionPhaseEnum('phase').notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  active: varchar('active', { length: 5 }).notNull().default('true'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
