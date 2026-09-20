import { Router } from 'express';
import {
  listSchools,
  getSchool,
  createSchool,
  updateSchool,
  deactivateSchool,
  listBlocks,
  createBlock,
  updateBlock,
  listDcOffices,
  createDcOffice,
  updateDcOffice,
  listCategories,
  createCategory,
  updateCategory,
  getConfig,
  updateConfig,
} from '../controllers/masterController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../config/constants.js';
import {
  schoolSchema,
  schoolUpdateSchema,
  dcOfficeSchema,
  dcOfficeUpdateSchema,
  categorySchema,
  categoryUpdateSchema,
  configSchema,
  blockSchema,
  blockUpdateSchema,
} from '../config/schemas.js';

const router = Router();
router.use(protect);

const admin = authorize(ROLES.ADMIN);
const stateOrAdmin = authorize(ROLES.STATE, ROLES.ADMIN);

/* Blocks — read within scope, admin writes. */
router.route('/blocks').get(listBlocks).post(admin, validate(blockSchema), createBlock);
router.put('/blocks/:id', admin, validate(blockUpdateSchema), updateBlock);

/* Schools — everyone reads within their scope, only admin writes. */
router
  .route('/schools')
  .get(listSchools)
  .post(admin, validate(schoolSchema), createSchool);
router
  .route('/schools/:id')
  .get(getSchool)
  .put(admin, validate(schoolUpdateSchema), updateSchool)
  .delete(admin, deactivateSchool);

/* DC offices */
router
  .route('/dc-offices')
  .get(listDcOffices)
  .post(admin, validate(dcOfficeSchema), createDcOffice);
router.put('/dc-offices/:id', admin, validate(dcOfficeUpdateSchema), updateDcOffice);

/* Bill categories — SSA maintains the budget heads. */
router
  .route('/categories')
  .get(listCategories)
  .post(stateOrAdmin, validate(categorySchema), createCategory);
router.put('/categories/:id', stateOrAdmin, validate(categoryUpdateSchema), updateCategory);

/* Global SLA + notification config */
router
  .route('/config')
  .get(getConfig)
  .put(stateOrAdmin, validate(configSchema), updateConfig);

export default router;
