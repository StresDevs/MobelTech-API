ALTER TABLE production_schedule_phases
ADD COLUMN IF NOT EXISTS cutting_machine varchar(20);

