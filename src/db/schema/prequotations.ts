import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  boolean,
  numeric,
  integer,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { measurements } from './measurements';
import { quotations } from './quotations';
import { contractors } from './contractors';

export const prequotationStatusEnum = pgEnum('prequotation_status', [
  'draft',
  'in-review',
  'adjustment',
  'confirmed',
  'rejected',
]);

export const prequotationLogActionEnum = pgEnum('prequotation_log_action', [
  'created',
  'file_uploaded',
  'file_downloaded',
  'status_changed',
  'comment_added',
  'converted_to_quotation',
]);

export const prequotations = pgTable('prequotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id),
  measurementId: uuid('measurement_id').references(() => measurements.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  status: prequotationStatusEnum('status').notNull().default('draft'),
  currentVersion: integer('current_version').notNull().default(1),
  createdBy: varchar('created_by', { length: 255 }).notNull(),
  assignedContractorId: uuid('assigned_contractor_id').references(() => contractors.id, { onDelete: 'set null' }),
  startDate: date('start_date'),
  estimatedDeliveryDate: date('estimated_delivery_date'),
  notes: text('notes'),
  convertedToQuotationId: uuid('converted_to_quotation_id').references(() => quotations.id, { onDelete: 'set null' }),
  billingRequested: boolean('billing_requested').notNull().default(false),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prequotationVersions = pgTable('prequotation_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  prequotationId: uuid('prequotation_id')
    .notNull()
    .references(() => prequotations.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 20 }).notNull(),
  fileSize: varchar('file_size', { length: 50 }).notNull(),
  uploadedBy: varchar('uploaded_by', { length: 255 }).notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  fileUrl: text('file_url'),
  metadata: jsonb('metadata'),
});

export const prequotationLogs = pgTable('prequotation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  prequotationId: uuid('prequotation_id')
    .notNull()
    .references(() => prequotations.id, { onDelete: 'cascade' }),
  action: prequotationLogActionEnum('action').notNull(),
  performedBy: varchar('performed_by', { length: 255 }).notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  description: text('description').notNull(),
  metadata: jsonb('metadata'),
});
