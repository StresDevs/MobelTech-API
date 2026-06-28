import { Router, Request, Response } from 'express';
import { desc, eq, inArray } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { z } from 'zod';
import { env } from '../config/env';
import { db } from '../db';
import {
  clients,
  furnitureFileLogs,
  furnitureFiles,
  projectEnvironments,
  quotations,
} from '../db/schema';
import { ensureFurnitureFilesSchema } from '../db/ensure-furniture-files';
import { validate } from '../middleware/validate';

const router = Router();
const sql = neon(env.DATABASE_URL);

type FurnitureFileRow = typeof furnitureFiles.$inferSelect;

const uploadFurnitureFileSchema = z.object({
  quotationId: z.string().uuid(),
  projectEnvironmentId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  assignedContractorId: z.string().uuid().optional().nullable(),
  fileKind: z.enum(['initial', 'contractor_final']).optional().default('initial'),
  fileName: z.string().min(1).max(255),
  fileSize: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  fileData: z.string().min(1),
  uploadedBy: z.string().min(1).max(160),
  notes: z.string().optional().nullable(),
});

async function getTableColumns(tableName: string) {
  const rows = await sql.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `,
    [tableName],
  ) as Array<{ column_name: string }>;

  return new Set(rows.map((row) => row.column_name));
}

function selectColumn(columns: Set<string>, columnName: string, alias: keyof FurnitureFileRow, fallback: string) {
  return columns.has(columnName)
    ? `"${columnName}" AS "${alias}"`
    : `${fallback} AS "${alias}"`;
}

async function getFurnitureFilesRows(contractorId: string | null): Promise<FurnitureFileRow[]> {
  const columns = await getTableColumns('furniture_files');
  if (!columns.has('id')) return [];
  if (contractorId && !columns.has('assigned_contractor_id')) return [];

  const selectList = [
    selectColumn(columns, 'id', 'id', 'gen_random_uuid()'),
    selectColumn(columns, 'quotation_id', 'quotationId', 'NULL::uuid'),
    selectColumn(columns, 'project_environment_id', 'projectEnvironmentId', 'NULL::uuid'),
    selectColumn(columns, 'client_id', 'clientId', 'NULL::uuid'),
    selectColumn(columns, 'assigned_contractor_id', 'assignedContractorId', 'NULL::uuid'),
    selectColumn(columns, 'file_kind', 'fileKind' as keyof FurnitureFileRow, "'initial'::varchar"),
    selectColumn(columns, 'version', 'version', '1'),
    selectColumn(columns, 'file_name', 'fileName', "'archivo-sketchup.skp'::varchar"),
    selectColumn(columns, 'file_size', 'fileSize', 'NULL::varchar'),
    selectColumn(columns, 'mime_type', 'mimeType', 'NULL::varchar'),
    "''::text AS \"fileData\"",
    selectColumn(columns, 'uploaded_by', 'uploadedBy', "'Sistema'::varchar"),
    selectColumn(columns, 'notes', 'notes', 'NULL::text'),
    selectColumn(columns, 'created_at', 'createdAt', 'now()'),
    selectColumn(columns, 'updated_at', 'updatedAt', 'now()'),
  ].join(', ');
  const orderBy = columns.has('created_at') ? 'ORDER BY "created_at" DESC' : '';
  const where = contractorId ? 'WHERE "assigned_contractor_id" = $1' : '';

  const rows = await sql.query(
    `SELECT ${selectList} FROM furniture_files ${where} ${orderBy}`,
    contractorId ? [contractorId] : [],
  );

  return rows as FurnitureFileRow[];
}

async function getFurnitureFileById(id: string): Promise<FurnitureFileRow | null> {
  const columns = await getTableColumns('furniture_files');
  if (!columns.has('id')) return null;

  const selectList = [
    selectColumn(columns, 'id', 'id', 'gen_random_uuid()'),
    selectColumn(columns, 'quotation_id', 'quotationId', 'NULL::uuid'),
    selectColumn(columns, 'project_environment_id', 'projectEnvironmentId', 'NULL::uuid'),
    selectColumn(columns, 'client_id', 'clientId', 'NULL::uuid'),
    selectColumn(columns, 'assigned_contractor_id', 'assignedContractorId', 'NULL::uuid'),
    selectColumn(columns, 'file_kind', 'fileKind' as keyof FurnitureFileRow, "'initial'::varchar"),
    selectColumn(columns, 'version', 'version', '1'),
    selectColumn(columns, 'file_name', 'fileName', "'archivo-sketchup.skp'::varchar"),
    selectColumn(columns, 'file_size', 'fileSize', 'NULL::varchar'),
    selectColumn(columns, 'mime_type', 'mimeType', 'NULL::varchar'),
    selectColumn(columns, 'file_data', 'fileData', "''::text"),
    selectColumn(columns, 'uploaded_by', 'uploadedBy', "'Sistema'::varchar"),
    selectColumn(columns, 'notes', 'notes', 'NULL::text'),
    selectColumn(columns, 'created_at', 'createdAt', 'now()'),
    selectColumn(columns, 'updated_at', 'updatedAt', 'now()'),
  ].join(', ');
  const rows = await sql.query(
    `SELECT ${selectList} FROM furniture_files WHERE "id" = $1 LIMIT 1`,
    [id],
  ) as FurnitureFileRow[];

  return rows[0] ?? null;
}

async function hydrateFurnitureFiles(rows: FurnitureFileRow[]) {
  if (rows.length === 0) return [];

  const quotationIds = Array.from(new Set(rows.map((row) => row.quotationId).filter((value): value is string => Boolean(value))));
  const environmentIds = Array.from(new Set(rows.map((row) => row.projectEnvironmentId).filter((value): value is string => Boolean(value))));
  const fileIds = rows.map((row) => row.id);

  const [quotationRows, environmentRows, logRows] = await Promise.all([
    quotationIds.length > 0
      ? db
          .select({
            id: quotations.id,
            uid: quotations.uid,
            clientId: quotations.clientId,
            clientName: clients.name,
          })
          .from(quotations)
          .leftJoin(clients, eq(quotations.clientId, clients.id))
          .where(inArray(quotations.id, quotationIds))
          .catch((error) => {
            console.error('Furniture quotations could not be loaded:', error instanceof Error ? error.message : error);
            return [];
          })
      : [],
    environmentIds.length > 0
      ? db
          .select({
            id: projectEnvironments.id,
            ambience: projectEnvironments.ambience,
          })
          .from(projectEnvironments)
          .where(inArray(projectEnvironments.id, environmentIds))
          .catch((error) => {
            console.error('Furniture environments could not be loaded:', error instanceof Error ? error.message : error);
            return [];
          })
      : [],
    db
      .select()
      .from(furnitureFileLogs)
      .where(inArray(furnitureFileLogs.furnitureFileId, fileIds))
      .orderBy(desc(furnitureFileLogs.performedAt))
      .catch((error) => {
        console.error('Furniture file logs could not be loaded:', error instanceof Error ? error.message : error);
        return [];
      }),
  ]);

  const quotationsById = new Map(quotationRows.map((row) => [row.id, row]));
  const environmentsById = new Map(environmentRows.map((row) => [row.id, row]));
  const logsByFileId = new Map<string, typeof logRows>();
  logRows.forEach((log) => {
    if (!log.furnitureFileId) return;
    const current = logsByFileId.get(log.furnitureFileId) ?? [];
    current.push(log);
    logsByFileId.set(log.furnitureFileId, current);
  });

  return rows.map((row) => {
    const quotation = row.quotationId ? quotationsById.get(row.quotationId) : null;
    const environment = row.projectEnvironmentId ? environmentsById.get(row.projectEnvironmentId) : null;

    return {
      ...row,
      fileData: undefined,
      quotationUid: quotation?.uid ?? null,
      clientName: quotation?.clientName ?? null,
      ambience: environment?.ambience ?? null,
      logs: logsByFileId.get(row.id) ?? [],
    };
  });
}

router.get('/', async (req: Request, res: Response) => {
  await ensureFurnitureFilesSchema();
  const contractorId = typeof req.query.contractorId === 'string' ? req.query.contractorId : null;
  const rows = await getFurnitureFilesRows(contractorId);

  res.json(await hydrateFurnitureFiles(rows));
});

router.post('/', validate(uploadFurnitureFileSchema), async (req: Request, res: Response) => {
  await ensureFurnitureFilesSchema();
  const body = req.body as z.infer<typeof uploadFurnitureFileSchema>;
  const previousRows = await db
    .select({ version: furnitureFiles.version })
    .from(furnitureFiles)
    .where(eq(furnitureFiles.quotationId, body.quotationId));
  const nextVersion = previousRows.reduce((max, row) => Math.max(max, row.version), 0) + 1;

  const [created] = await db.insert(furnitureFiles).values({
    quotationId: body.quotationId,
    projectEnvironmentId: body.projectEnvironmentId ?? null,
    clientId: body.clientId ?? null,
    assignedContractorId: body.assignedContractorId ?? null,
    fileKind: body.fileKind ?? 'initial',
    version: nextVersion,
    fileName: body.fileName,
    fileSize: body.fileSize ?? null,
    mimeType: body.mimeType ?? null,
    fileData: body.fileData,
    uploadedBy: body.uploadedBy,
    notes: body.notes ?? null,
  }).returning();

  await db.insert(furnitureFileLogs).values({
    furnitureFileId: created.id,
    action: 'file_uploaded',
    performedBy: body.uploadedBy,
    description: `Archivo SketchUp subido: ${body.fileName} (v${nextVersion})`,
  });

  const [hydrated] = await hydrateFurnitureFiles([created]);
  res.status(201).json(hydrated);
});

router.post('/contractor-final', validate(uploadFurnitureFileSchema.extend({
  projectEnvironmentId: z.string().uuid(),
  assignedContractorId: z.string().uuid(),
})), async (req: Request, res: Response) => {
  await ensureFurnitureFilesSchema();
  const body = req.body as z.infer<typeof uploadFurnitureFileSchema> & {
    projectEnvironmentId: string;
    assignedContractorId: string;
  };

  const previousRows = await db
    .select({ id: furnitureFiles.id, version: furnitureFiles.version })
    .from(furnitureFiles)
    .where(eq(furnitureFiles.projectEnvironmentId, body.projectEnvironmentId));
  const previousFinalRows = previousRows.filter((row) => row.id);
  const nextVersion = previousRows.reduce((max, row) => Math.max(max, row.version), 0) + 1;

  await sql.query(
    `
      DELETE FROM furniture_files
      WHERE project_environment_id = $1
        AND assigned_contractor_id = $2
        AND file_kind = 'contractor_final'
    `,
    [body.projectEnvironmentId, body.assignedContractorId],
  );

  const [created] = await db.insert(furnitureFiles).values({
    quotationId: body.quotationId,
    projectEnvironmentId: body.projectEnvironmentId,
    clientId: body.clientId ?? null,
    assignedContractorId: body.assignedContractorId,
    fileKind: 'contractor_final',
    version: nextVersion,
    fileName: body.fileName,
    fileSize: body.fileSize ?? null,
    mimeType: body.mimeType ?? null,
    fileData: body.fileData,
    uploadedBy: body.uploadedBy,
    notes: body.notes ?? 'SketchUp final del contratista',
  }).returning();

  await db.insert(furnitureFileLogs).values({
    furnitureFileId: created.id,
    action: 'file_uploaded',
    performedBy: body.uploadedBy,
    description: `SketchUp final reemplazado: ${body.fileName} (v${nextVersion}, anteriores: ${previousFinalRows.length})`,
  });

  const [hydrated] = await hydrateFurnitureFiles([created]);
  res.status(201).json(hydrated);
});

router.get('/:id/download', async (req: Request, res: Response) => {
  await ensureFurnitureFilesSchema();
  const file = await getFurnitureFileById(req.params.id as string);
  if (!file) {
    res.status(404).json({ error: 'Furniture file not found' });
    return;
  }

  const performedBy = typeof req.query.performedBy === 'string' ? req.query.performedBy : 'Usuario';
  await db.insert(furnitureFileLogs).values({
    furnitureFileId: file.id,
    action: 'file_downloaded',
    performedBy,
    description: `Archivo SketchUp descargado: ${file.fileName} (v${file.version})`,
  });

  res.json({
    id: file.id,
    fileName: file.fileName,
    fileSize: file.fileSize,
    mimeType: file.mimeType,
    fileData: file.fileData,
  });
});

export default router;
