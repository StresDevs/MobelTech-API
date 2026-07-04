import { neon } from '@neondatabase/serverless';
import { env } from '../config/env';

const sql = neon(env.DATABASE_URL);

let ensurePromise: Promise<void> | null = null;

export function ensureProductionSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type
            WHERE typname = 'production_status'
          ) THEN
            CREATE TYPE production_status AS ENUM ('pending', 'in-progress', 'delayed', 'completed');
          END IF;
        END $$;
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type
            WHERE typname = 'production_phase'
          ) THEN
            CREATE TYPE production_phase AS ENUM ('cortado', 'canteado', 'ensamblado', 'instalacion', 'entregado');
          END IF;
        END $$;
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_type
            WHERE typname = 'production_schedule_type'
          ) THEN
            CREATE TYPE production_schedule_type AS ENUM ('tentative', 'actual', 'real');
          END IF;
        END $$;
      `;

      await sql`
        ALTER TYPE production_schedule_type ADD VALUE IF NOT EXISTS 'real'
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS production_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
          quotation_id uuid REFERENCES quotations(id),
          assigned_contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
          status production_status NOT NULL DEFAULT 'pending',
          start_date date NOT NULL,
          estimated_delivery_date date NOT NULL,
          actual_delivery_date date,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS production_items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
          description text NOT NULL,
          quantity integer NOT NULL DEFAULT 1,
          progress integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS production_item_phases (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          production_item_id uuid NOT NULL REFERENCES production_items(id) ON DELETE CASCADE,
          phase production_phase NOT NULL,
          completed varchar(5) NOT NULL DEFAULT 'false',
          completed_date timestamptz
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS production_schedule_phases (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
          type production_schedule_type NOT NULL,
          phase production_phase NOT NULL,
          start_date date NOT NULL,
          end_date date NOT NULL,
          completed varchar(5) NOT NULL DEFAULT 'false',
          cutting_machine varchar(80),
          created_by uuid,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        ALTER TABLE production_orders
          ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES quotations(id),
          ADD COLUMN IF NOT EXISTS assigned_contractor_id uuid REFERENCES contractors(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS status production_status NOT NULL DEFAULT 'pending',
          ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS estimated_delivery_date date NOT NULL DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS actual_delivery_date date,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
      `;

      await sql`
        ALTER TABLE production_items
          ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
      `;

      await sql`
        ALTER TABLE production_item_phases
          ADD COLUMN IF NOT EXISTS production_item_id uuid REFERENCES production_items(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS phase production_phase NOT NULL,
          ADD COLUMN IF NOT EXISTS completed varchar(5) NOT NULL DEFAULT 'false',
          ADD COLUMN IF NOT EXISTS completed_date timestamptz
      `;

      await sql`
        ALTER TABLE production_schedule_phases
          ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS type production_schedule_type NOT NULL,
          ADD COLUMN IF NOT EXISTS phase production_phase NOT NULL,
          ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS end_date date NOT NULL DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS completed varchar(5) NOT NULL DEFAULT 'false',
          ADD COLUMN IF NOT EXISTS cutting_machine varchar(80),
          ADD COLUMN IF NOT EXISTS created_by uuid,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
      `;

      await sql`
        ALTER TABLE production_schedule_phases
          ALTER COLUMN cutting_machine TYPE varchar(80)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS production_phase_machines (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          phase production_phase NOT NULL,
          name varchar(80) NOT NULL,
          active varchar(5) NOT NULL DEFAULT 'true',
          sort_order integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;

      await sql`
        ALTER TABLE production_phase_machines
          ADD COLUMN IF NOT EXISTS phase production_phase NOT NULL DEFAULT 'cortado',
          ADD COLUMN IF NOT EXISTS name varchar(80) NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS active varchar(5) NOT NULL DEFAULT 'true',
          ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS production_phase_machines_phase_name_idx
        ON production_phase_machines(phase, lower(name))
      `;

      await sql`
        INSERT INTO production_phase_machines (phase, name, sort_order)
        VALUES
          ('cortado', 'Cortadora 1', 1),
          ('cortado', 'Cortadora 2', 2),
          ('canteado', 'Máquina 1', 1),
          ('canteado', 'Máquina 2', 2)
        ON CONFLICT DO NOTHING
      `;

      console.log('✅ Production schema is ready.');
    })();
  }

  return ensurePromise;
}
