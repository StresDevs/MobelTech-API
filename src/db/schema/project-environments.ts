import {
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { quotations } from './quotations';
import { projects } from './projects';
import { contractors } from './contractors';

export const projectEnvironments = pgTable('project_environments', {
  id: uuid('id').primaryKey().defaultRandom(),
  quotationId: uuid('quotation_id')
    .notNull()
    .references(() => quotations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  assignedContractorId: uuid('assigned_contractor_id').references(() => contractors.id, { onDelete: 'set null' }),
  ambience: varchar('ambience', { length: 160 }).notNull(),
  description: text('description'),
  sketchupFileName: varchar('sketchup_file_name', { length: 255 }),
  sketchupFileUrl: text('sketchup_file_url'),
  sketchupFileSize: varchar('sketchup_file_size', { length: 80 }),
  price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
  clientPrice: numeric('client_price', { precision: 12, scale: 2 }).notNull().default('0'),
  estimatedStartDate: date('estimated_start_date').notNull(),
  estimatedEndDate: date('estimated_end_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
