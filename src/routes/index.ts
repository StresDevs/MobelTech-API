import { Router } from 'express';
import authRouter from './auth';
import clientsRouter from './clients';
import contractorsRouter from './contractors';
import measurementsRouter from './measurements';
import projectsRouter from './projects';
import prequotationsRouter from './prequotations';

const router = Router();

router.use('/auth', authRouter);
router.use('/clients', clientsRouter);
router.use('/contractors', contractorsRouter);
router.use('/measurements', measurementsRouter);
router.use('/projects', projectsRouter);
router.use('/prequotations', prequotationsRouter);

export default router;
