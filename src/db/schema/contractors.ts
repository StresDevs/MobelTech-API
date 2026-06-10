import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const contractorStatusEnum = pgEnum('contractor_status', [
  'active',
  'inactive',
]);

export const contractors = pgTable('contractors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  email: varchar('email', { length: 255 }),
  specialization: varchar('specialization', { length: 255 }),
  status: contractorStatusEnum('status').notNull().default('active'),
  advance1: numeric('advance1', { precision: 12, scale: 2 }).default('0'),
  advance2: numeric('advance2', { precision: 12, scale: 2 }),
  advance3: numeric('advance3', { precision: 12, scale: 2 }),
  balance: numeric('balance', { precision: 12, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
