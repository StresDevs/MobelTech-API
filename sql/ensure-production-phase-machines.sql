ALTER TABLE production_schedule_phases
  ADD COLUMN IF NOT EXISTS cutting_machine varchar(80);

ALTER TABLE production_schedule_phases
  ALTER COLUMN cutting_machine TYPE varchar(80);

CREATE TABLE IF NOT EXISTS production_phase_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase production_phase NOT NULL,
  name varchar(80) NOT NULL,
  active varchar(5) NOT NULL DEFAULT 'true',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE production_phase_machines
  ADD COLUMN IF NOT EXISTS phase production_phase NOT NULL DEFAULT 'cortado',
  ADD COLUMN IF NOT EXISTS name varchar(80) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS active varchar(5) NOT NULL DEFAULT 'true',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS production_phase_machines_phase_name_idx
  ON production_phase_machines(phase, lower(name));

INSERT INTO production_phase_machines (phase, name, sort_order)
VALUES
  ('cortado', 'Cortadora 1', 1),
  ('cortado', 'Cortadora 2', 2),
  ('canteado', 'Máquina 1', 1),
  ('canteado', 'Máquina 2', 2)
ON CONFLICT DO NOTHING;
