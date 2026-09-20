import { Router } from 'express';
import {
  exportClaims,
  exportBeneficiary,
  exportSlaReport,
  exportBlockSummary,
  exportAuditLog,
} from '../controllers/reportController.js';
import { protect, authorize } from '../middleware/auth.js';
import { ROLES } from '../config/constants.js';

const router = Router();
router.use(protect);

// Any signed-in user can export their own scope.
router.get('/claims.xlsx', exportClaims);

// Payment and oversight files stay with the DC and state offices.
const officeOnly = authorize(ROLES.DC, ROLES.STATE, ROLES.ADMIN);
router.get('/beneficiary.xlsx', officeOnly, exportBeneficiary);
router.get('/sla.xlsx', officeOnly, exportSlaReport);
router.get('/block-summary.xlsx', officeOnly, exportBlockSummary);
router.get('/audit.xlsx', authorize(ROLES.STATE, ROLES.ADMIN), exportAuditLog);

export default router;
