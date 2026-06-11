import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'admin',
  'contractor',
  'architect',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('admin'),
  avatar: text('avatar'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
