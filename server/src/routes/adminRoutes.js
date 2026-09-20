import { Router } from 'express';
import {
  previewMaster,
  importMaster,
  downloadTemplate,
  previewProvisioning,
  commitProvisioningEndpoint,
  exportCredentials,
  getHierarchy,
} from '../controllers/adminController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadSheet } from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';
import { provisionPreviewSchema, provisionCommitSchema } from '../config/schemas.js';

const router = Router();
router.use(protect);

const admin = authorize(ROLES.ADMIN);
const sheet = uploadSheet.single('file');

/* Master data — admin uploads, everyone downstream inherits the hierarchy. */
router.get('/master/template.xlsx', admin, downloadTemplate);
router.post('/master/preview', admin, sheet, previewMaster);
router.post('/master/import', admin, sheet, importMaster);

/* Login provisioning driven by the uploaded master data. */
router.post('/provision/preview', admin, validate(provisionPreviewSchema), previewProvisioning);
router.post('/provision/commit', admin, validate(provisionCommitSchema), commitProvisioningEndpoint);
router.post('/provision/export.xlsx', admin, exportCredentials);

/* Coverage view: who exists, who is still missing a login. */
router.get('/hierarchy', authorize(ROLES.ADMIN, ROLES.STATE), getHierarchy);

export default router;
