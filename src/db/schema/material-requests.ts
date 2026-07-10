import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { contractors } from './contractors';
import { materials } from './inventory';
import { productionOrders } from './production';
import { users } from './users';

export const materialRequestStatusEnum = pgEnum('material_request_status', [
  'pending',
  'approved',
  'rejected',
]);

export const materialRequests = pgTable('material_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractorId: uuid('contractor_id')
    .notNull()
    .references(() => contractors.id, { onDelete: 'cascade' }),
  productionOrderId: uuid('production_order_id')
    .references(() => productionOrders.id, { onDelete: 'set null' }),
  submittedByUserId: uuid('submitted_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  reviewedByUserId: uuid('reviewed_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  status: materialRequestStatusEnum('status').notNull().default('pending'),
  rejectionComments: text('rejection_comments'),
  adminNotes: text('admin_notes'),
  requestDate: timestamp('request_date', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const materialRequestItems = pgTable('material_request_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialRequestId: uuid('material_request_id')
    .notNull()
    .references(() => materialRequests.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const materialRequestItemAdjustments = pgTable('material_request_item_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialRequestId: uuid('material_request_id')
    .notNull()
    .references(() => materialRequests.id, { onDelete: 'cascade' }),
  materialRequestItemId: uuid('material_request_item_id')
    .notNull()
    .references(() => materialRequestItems.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id')
    .notNull()
    .references(() => materials.id, { onDelete: 'restrict' }),
  previousQuantity: integer('previous_quantity').notNull(),
  newQuantity: integer('new_quantity').notNull(),
  note: text('note'),
  changedByUserId: uuid('changed_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
