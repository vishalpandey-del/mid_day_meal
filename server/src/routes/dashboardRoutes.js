import { Router } from 'express';
import {
  getDashboard,
  getBlockSummary,
  getMyQueue,
  getSchoolSummary,
} from '../controllers/dashboardController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = Router();
router.use(protect);

router.get('/', getDashboard);

// Every reviewing role has its own queue; the stage is derived from the role.
router.get('/queue', getMyQueue);
router.get('/blocks', authorize(ROLES.BLOCK, ROLES.DC, ROLES.STATE, ROLES.ADMIN), getBlockSummary);
router.get('/school/:id', getSchoolSummary);

export default router;
