import { Router } from 'express';
import {
  allocateToDc,
  allocateToSchool,
  listBudgets,
  getSchoolBudget,
  getSchoolLedger,
  getDcBudget,
  deleteBudget,
} from '../controllers/budgetController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../config/constants.js';
import { dcBudgetSchema, schoolBudgetSchema } from '../config/schemas.js';

const router = Router();
router.use(protect);

const state = authorize(ROLES.STATE, ROLES.ADMIN);
const dcOrAbove = authorize(ROLES.DC, ROLES.STATE, ROLES.ADMIN);

router.get('/', listBudgets);

// State allocates down to a DC office; the DC then allocates to its schools.
router.post('/dc', state, validate(dcBudgetSchema), allocateToDc);
router.post('/school', dcOrAbove, validate(schoolBudgetSchema), allocateToSchool);

router.get('/dc/:id', dcOrAbove, getDcBudget);
router.get('/school/:id', getSchoolBudget);
router.get('/school/:id/ledger', getSchoolLedger);

router.delete('/:id', dcOrAbove, deleteBudget);

export default router;
