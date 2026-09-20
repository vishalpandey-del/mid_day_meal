import { Router } from 'express';
import {
  listClaims,
  getClaim,
  createClaim,
  updateClaim,
  submitClaim,
  deleteClaim,
  forwardClaim,
  returnClaim,
  reopenClaim,
  approveClaim,
  bulkApproveClaims,
  rejectClaim,
  queryClaim,
  respondToQuery,
  setPaymentStatus,
  reviseExportedStatus,
  addAttachments,
  downloadAttachment,
} from '../controllers/claimController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadBill, enforceTotalUploadSize } from '../middleware/upload.js';
import { ROLES } from '../config/constants.js';
import {
  claimSchema,
  claimUpdateSchema,
  remarksSchema,
  reviewRemarkSchema,
  returnSchema,
  rejectSchema,
  reopenSchema,
  querySchema,
  queryResponseSchema,
  bulkApproveSchema,
  paymentSchema,
  reviseStatusSchema,
} from '../config/schemas.js';

const router = Router();
router.use(protect);

/* The size guard runs first so an oversized batch is answered, not dropped. */
const files = [enforceTotalUploadSize, uploadBill.array('documents', 10)];
const maker = authorize(ROLES.SCHOOL_MAKER);
/* The block office reviews nothing — it only watches what sits under it. */
const reviewer = authorize(ROLES.SCHOOL_CHECKER);
const dc = authorize(ROLES.DC);

/* Bulk action sits above /:id so "bulk-approve" is not read as an id. */
router.post('/bulk-approve', dc, validate(bulkApproveSchema), bulkApproveClaims);

router.route('/').get(listClaims).post(maker, files, validate(claimSchema), createClaim);

router
  .route('/:id')
  .get(getClaim)
  .put(maker, files, validate(claimUpdateSchema), updateClaim)
  .delete(maker, deleteClaim);

/* Maker actions */
router.post('/:id/submit', maker, submitClaim);
router.post('/:id/respond', maker, files, validate(queryResponseSchema), respondToQuery);

/* Review chain — checker and block may only add a remark. */
router.post('/:id/forward', reviewer, validate(reviewRemarkSchema), forwardClaim);
router.post('/:id/return', reviewer, validate(returnSchema), returnClaim);

/* DC decisions */
router.post('/:id/approve', dc, validate(remarksSchema), approveClaim);
router.post('/:id/reject', dc, validate(rejectSchema), rejectClaim);
router.post('/:id/reopen', dc, validate(reopenSchema), reopenClaim);
router.post('/:id/query', dc, validate(querySchema), queryClaim);

/* Payment tracking and post-export corrections are DC-only. */
router.patch('/:id/payment', dc, validate(paymentSchema), setPaymentStatus);
router.patch('/:id/revise-status', dc, validate(reviseStatusSchema), reviseExportedStatus);

/* Attachments */
router.post('/:id/attachments', files, addAttachments);
router.get('/:id/attachments/:storedName', downloadAttachment);

export default router;
