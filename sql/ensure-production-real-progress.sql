ALTER TYPE production_schedule_type ADD VALUE IF NOT EXISTS 'real';

ALTER TABLE production_schedule_phases
  ADD COLUMN IF NOT EXISTS completed varchar(5) NOT NULL DEFAULT 'false';
