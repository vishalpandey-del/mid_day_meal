import { Router } from 'express';
import {
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  toggleUserStatus,
  bulkCreateSchoolUsers,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listAuditLogs,
  transferPreview,
  transfer,
  postingHistory,
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../config/constants.js';
import {
  userSchema,
  userUpdateSchema,
  resetPasswordSchema,
  statusSchema,
  transferSchema,
} from '../config/schemas.js';

const router = Router();
router.use(protect);

const admin = authorize(ROLES.ADMIN);

/*
 * The DC administers its own district alongside the admin. The controller
 * narrows every one of these to the district, so this gate opens the door
 * and the scope decides what is behind it.
 */
const userAdmin = authorize(ROLES.ADMIN, ROLES.DC);

/* Notifications belong to the signed-in user, so no role gate. */
router.get('/notifications', listNotifications);
router.patch('/notifications/read-all', markAllNotificationsRead);
router.patch('/notifications/:id/read', markNotificationRead);

/* Audit trail is oversight, not administration. */
router.get('/audit', authorize(ROLES.STATE, ROLES.ADMIN), listAuditLogs);

/* User administration */
router.route('/').get(userAdmin, listUsers).post(userAdmin, validate(userSchema), createUser);
router.post('/bulk-school-users', admin, bulkCreateSchoolUsers);
router.put('/:id', userAdmin, validate(userUpdateSchema), updateUser);
router.post('/:id/reset-password', userAdmin, validate(resetPasswordSchema), resetPassword);
router.patch('/:id/status', userAdmin, validate(statusSchema), toggleUserStatus);

/* Transfers — the posting moves, the pending work stays with the post. */
router.get('/:id/transfer-preview', admin, transferPreview);
router.post('/:id/transfer', admin, validate(transferSchema), transfer);
router.get('/:id/postings', admin, postingHistory);

export default router;
