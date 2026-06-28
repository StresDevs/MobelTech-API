import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { contractors } from './contractors';
import { projectEnvironments } from './project-environments';
import { quotations } from './quotations';

export const furnitureFileLogActionEnum = pgEnum('furniture_file_log_action', [
  'file_uploaded',
  'file_downloaded',
]);

export const furnitureFiles = pgTable('furniture_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'cascade' }),
  projectEnvironmentId: uuid('project_environment_id').references(() => projectEnvironments.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  assignedContractorId: uuid('assigned_contractor_id').references(() => contractors.id, { onDelete: 'set null' }),
  fileKind: varchar('file_kind', { length: 40 }).notNull().default('initial'),
  version: integer('version').notNull().default(1),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSize: varchar('file_size', { length: 80 }),
  mimeType: varchar('mime_type', { length: 160 }),
  fileData: text('file_data').notNull(),
  uploadedBy: varchar('uploaded_by', { length: 160 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const furnitureFileLogs = pgTable('furniture_file_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  furnitureFileId: uuid('furniture_file_id').references(() => furnitureFiles.id, { onDelete: 'cascade' }),
  action: furnitureFileLogActionEnum('action').notNull(),
  performedBy: varchar('performed_by', { length: 160 }).notNull(),
  description: text('description').notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
});
