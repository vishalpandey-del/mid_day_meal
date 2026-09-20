import User from '../models/User.js';
import School from '../models/School.js';
import Block from '../models/Block.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import { AUDIT_ACTIONS, ROLES, SCHOOL_ROLES } from '../config/constants.js';
import { safeRegex, userAdminScope, manageableRoles } from '../utils/scope.js';
import {
  transferUser,
  describeCurrentPosting,
  pendingWorkAt,
} from '../services/transferService.js';

/* ------------------------------------------------------------------ *
 * User administration
 *
 * The admin manages everyone. A DC manages its own district — the block
 * offices under it and the school logins under those — so a wrong name or a
 * forgotten password is fixed locally instead of waiting on the state.
 * Every handler here resolves that scope first and refuses anything outside
 * it, so the route guard alone is never what keeps a DC in its district.
 * ------------------------------------------------------------------ */

/** The scope for this request, or a 403 if the role manages nobody. */
const scopeFor = async (user) => {
  const scope = await userAdminScope(user, { School, Block });
  if (!scope) throw ApiError.forbidden('Your role does not manage user accounts.');
  return scope;
};

/** Loads a user only if the signed-in administrator may act on them. */
const findInScope = async (id, actor, select) => {
  const scope = await scopeFor(actor);
  const q = User.findOne({ $and: [{ _id: id }, scope] });
  if (select) q.select(select);
  const user = await q;
  if (!user) {
    throw ApiError.notFound('That user is not in your district, or does not exist.');
  }
  return user;
};

/** Refuses a role the administrator is not allowed to hand out. */
const assertRoleAllowed = (role, actor) => {
  if (!role) return;
  const allowed = manageableRoles(actor);
  if (!allowed.includes(role)) {
    throw ApiError.forbidden(
      `You cannot manage "${role}" accounts. You may manage: ${allowed.join(', ')}.`
    );
  }
};

export const listUsers = asyncHandler(async (req, res) => {
  const { role, q, active, page = 1, limit = 50 } = req.query;
  const filter = { $and: [await scopeFor(req.user)] };

  if (role) filter.role = role;
  if (active !== undefined) filter.isActive = active === 'true';
  if (q) {
    const rx = safeRegex(q);
    // Nested under $and so a search never widens the district scope.
    filter.$and.push({ $or: [{ name: rx }, { userId: rx }, { email: rx }, { designation: rx }] });
  }

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [users, total] = await Promise.all([
    User.find(filter)
      .populate('school', 'name code block')
      .populate('block', 'name code')
      .populate('dcOffice', 'name code')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(perPage),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: users.length,
    total,
    page: Number(page) || 1,
    pages: Math.ceil(total / perPage) || 1,
    users,
  });
});

/** POST /api/users — role determines which scope field is mandatory. */
export const createUser = asyncHandler(async (req, res) => {
  const { role, school, block, dcOffice } = req.body;
  assertRoleAllowed(role, req.user);

  if (SCHOOL_ROLES.includes(role) && !school) {
    throw ApiError.badRequest('A school maker/checker must be linked to a school.');
  }
  if (role === ROLES.BLOCK && !block) {
    throw ApiError.badRequest('A block user must be linked to a block.');
  }
  if (role === ROLES.DC && !dcOffice) {
    throw ApiError.badRequest('A DC user must be linked to a DC office.');
  }

  if (await User.exists({ userId: req.body.userId })) {
    throw ApiError.conflict(`User ID "${req.body.userId}" is already taken.`);
  }

  const user = await User.create(req.body);

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_CREATED,
    detail: `${user.userId} · ${user.name} · role=${user.role}`,
  });

  const created = await User.findById(user._id)
    .populate('school')
    .populate('block')
    .populate('dcOffice');
  res.status(201).json({ success: true, user: created });
});

/** PUT /api/users/:id — password changes go through resetPassword instead. */
export const updateUser = asyncHandler(async (req, res) => {
  const { password, ...safe } = req.body;

  // Check the target is in scope before writing, and the new role too.
  await findInScope(req.params.id, req.user);
  assertRoleAllowed(safe.role, req.user);

  const user = await User.findByIdAndUpdate(req.params.id, safe, {
    new: true,
    runValidators: true,
  })
    .populate('school')
    .populate('block')
    .populate('dcOffice');

  if (!user) throw ApiError.notFound('User not found.');

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_UPDATED,
    detail: `${user.userId} · ${user.name}`,
  });

  res.json({ success: true, user });
});

/** POST /api/users/:id/reset-password — admin sets a new password directly. */
export const resetPassword = asyncHandler(async (req, res) => {
  const user = await findInScope(req.params.id, req.user, '+password');

  user.password = req.body.newPassword;
  await user.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_UPDATED,
    detail: `Password reset for ${user.userId}`,
  });

  res.json({ success: true, message: `Password reset for ${user.userId}.` });
});

/** PATCH /api/users/:id/status — activate or deactivate; admins cannot lock themselves out. */
export const toggleUserStatus = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account.');
  }

  const user = await findInScope(req.params.id, req.user);

  user.isActive = req.body.isActive;
  await user.save({ validateBeforeSave: false });

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_UPDATED,
    detail: `${user.userId} ${user.isActive ? 'activated' : 'deactivated'}`,
  });

  res.json({ success: true, user });
});

/**
 * POST /api/users/bulk-school-users — one login per active school, generated
 * from the school code. Existing accounts are left untouched.
 */
export const bulkCreateSchoolUsers = asyncHandler(async (req, res) => {
  const defaultPassword = req.body.defaultPassword || 'School@123';
  const schools = await School.find({ isActive: true }).select(
    'code name headTeacher mobile email blockRef'
  );

  const created = [];
  const skipped = [];

  // Every school gets a maker (MKR) and a checker (CHK) login.
  for (const s of schools) {
    for (const [prefix, role, designation] of [
      ['MKR', ROLES.SCHOOL_MAKER, 'Head Teacher (Maker)'],
      ['CHK', ROLES.SCHOOL_CHECKER, 'Reviewing Authority (Checker)'],
    ]) {
      const userId = `${prefix}${s.code}`;
      if (await User.exists({ userId })) {
        skipped.push(userId);
        continue;
      }
      await User.create({
        userId,
        name: role === ROLES.SCHOOL_MAKER ? s.headTeacher || s.name : `${s.name} Checker`,
        password: defaultPassword,
        role,
        school: s._id,
        mobile: s.mobile || '',
        email: s.email || '',
        designation,
      });
      created.push(userId);
    }
  }

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_CREATED,
    detail: `Bulk school users — ${created.length} created, ${skipped.length} already existed`,
  });

  res.status(201).json({ success: true, created, skipped, defaultPassword });
});

/* ------------------------------------------------------------------ *
 * Notifications (current user)
 * ------------------------------------------------------------------ */

export const listNotifications = asyncHandler(async (req, res) => {
  const { unread, limit = 30 } = req.query;
  const filter = { recipient: req.user._id };
  if (unread === 'true') filter.isRead = false;

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 30, 100)),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);

  res.json({ success: true, unreadCount, notifications });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!n) throw ApiError.notFound('Notification not found.');
  res.json({ success: true, notification: n });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const { modifiedCount } = await Notification.updateMany(
    { recipient: req.user._id, isRead: false },
    { isRead: true }
  );
  res.json({ success: true, updated: modifiedCount });
});

/* ------------------------------------------------------------------ *
 * Audit trail (admin / SSA)
 * ------------------------------------------------------------------ */

export const listAuditLogs = asyncHandler(async (req, res) => {
  const { action, claimId, userId, q, from, to, page = 1, limit = 50 } = req.query;
  const filter = {};

  // One box that searches the whole line: who did it, to what, and the note.
  if (q) {
    const rx = safeRegex(q);
    filter.$or = [
      { userName: rx }, { userId: rx }, { claimId: rx }, { detail: rx }, { action: rx },
    ];
  }

  if (action) filter.action = action;
  if (claimId) filter.claimId = claimId.toUpperCase();
  if (userId) filter.userId = userId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(perPage),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: logs.length,
    total,
    page: Number(page) || 1,
    pages: Math.ceil(total / perPage) || 1,
    logs,
  });
});

/* ------------------------------------------------------------------ *
 * Transfers — an officer moves, the login moves with them
 * ------------------------------------------------------------------ */

/**
 * GET /api/users/:id/transfer-preview — where the user sits now, and what
 * work is waiting there, so the admin can confirm before moving them.
 */
export const transferPreview = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');

  const [current, pending] = await Promise.all([
    describeCurrentPosting(user),
    pendingWorkAt(user),
  ]);

  res.json({
    success: true,
    user: { id: user._id, userId: user.userId, name: user.name, role: user.role },
    currentPosting: current,
    pendingWork: pending,
    postings: user.postings,
  });
});

/**
 * POST /api/users/:id/transfer — move the user to a new school, block or
 * district. Their scope changes immediately: the new place becomes visible
 * and the old one disappears.
 */
export const transfer = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');

  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot transfer your own account.');
  }

  const { schoolId, blockId, districtId, role, note } = req.body;

  const result = await transferUser({
    user,
    destination: { schoolId, blockId, districtId },
    newRole: role,
    note,
    actor: req.user,
  });

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_TRANSFERRED,
    detail: `${user.userId} · ${user.name} · ${result.from} → ${result.to}${
      role && role !== user.role ? ` · role ${role}` : ''
    }${note ? ` · ${note}` : ''}`,
  });

  const fresh = await User.findById(user._id)
    .populate('school', 'name code')
    .populate('block', 'name blockId')
    .populate('dcOffice', 'district districtId');

  res.json({
    success: true,
    message: `${user.name} transferred from ${result.from} to ${result.to}.`,
    transfer: result,
    user: fresh,
  });
});

/** GET /api/users/:id/postings — the full posting history of one user. */
export const postingHistory = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('userId name role postings transferredAt')
    .populate('postings.byUser', 'name userId');
  if (!user) throw ApiError.notFound('User not found.');

  res.json({ success: true, user });
});
