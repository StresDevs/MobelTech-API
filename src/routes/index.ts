import { Router } from 'express';
import authRouter from './auth';
import clientsRouter from './clients';
import contractorsRouter from './contractors';
import measurementsRouter from './measurements';
import materialsRouter from './materials';
import materialRequestsRouter from './material-requests';
import productionOrdersRouter from './production-orders';
import projectsRouter from './projects';
import prequotationsRouter from './prequotations';
import preferencesRouter from './preferences';
import quotationsRouter from './quotations';
import notificationsRouter from './notifications';
import inventoryRouter from './inventory';
import usersRouter from './users';
import contractorFinanceRouter from './contractor-finance';
import furnitureFilesRouter from './furniture-files';

const router = Router();

router.use('/auth', authRouter);
router.use('/clients', clientsRouter);
router.use('/contractors', contractorsRouter);
router.use('/measurements', measurementsRouter);
router.use('/materials', materialsRouter);
router.use('/material-requests', materialRequestsRouter);
router.use('/production-orders', productionOrdersRouter);
router.use('/projects', projectsRouter);
router.use('/prequotations', prequotationsRouter);
router.use('/quotations', quotationsRouter);
router.use('/notifications', notificationsRouter);
router.use('/preferences', preferencesRouter);
router.use('/inventory', inventoryRouter);
router.use('/users', usersRouter);
router.use('/contractor-finance', contractorFinanceRouter);
router.use('/furniture-files', furnitureFilesRouter);

export default router;
