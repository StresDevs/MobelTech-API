import { Router } from 'express';
import clientsRouter from './clients';
import measurementsRouter from './measurements';
import projectsRouter from './projects';

const router = Router();

router.use('/clients', clientsRouter);
router.use('/measurements', measurementsRouter);
router.use('/projects', projectsRouter);

export default router;
