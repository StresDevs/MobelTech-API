import { Router, Request, Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
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

const uploadFurnitureFileSchema = z.object({
  quotationId: z.string().uuid(),
  projectEnvironmentId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  assignedContractorId: z.string().uuid().optional().nullable(),
  fileName: z.string().min(1).max(255),
  fileSize: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  fileData: z.string().min(1),
  uploadedBy: z.string().min(1).max(160),
  notes: z.string().optional().nullable(),
});

async function hydrateFurnitureFiles(rows: Array<typeof furnitureFiles.$inferSelect>) {
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
      : [],
    environmentIds.length > 0
      ? db
          .select({
            id: projectEnvironments.id,
            ambience: projectEnvironments.ambience,
          })
          .from(projectEnvironments)
          .where(inArray(projectEnvironments.id, environmentIds))
      : [],
    db
      .select()
      .from(furnitureFileLogs)
      .where(inArray(furnitureFileLogs.furnitureFileId, fileIds))
      .orderBy(desc(furnitureFileLogs.performedAt)),
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
  const conditions = contractorId ? [eq(furnitureFiles.assignedContractorId, contractorId)] : [];

  const rows = await db
    .select()
    .from(furnitureFiles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(furnitureFiles.createdAt));

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

router.get('/:id/download', async (req: Request, res: Response) => {
  await ensureFurnitureFilesSchema();
  const [file] = await db.select().from(furnitureFiles).where(eq(furnitureFiles.id, req.params.id as string));
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
