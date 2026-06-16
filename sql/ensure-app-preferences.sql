-- Stores app-level UI preferences such as prequotation filters.
-- Safe to run more than once in Neon.

CREATE TABLE IF NOT EXISTS "app_preferences" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
