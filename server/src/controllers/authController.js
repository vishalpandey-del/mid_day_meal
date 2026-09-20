import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import { AUDIT_ACTIONS } from '../config/constants.js';

const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

const shapeUser = (user) => ({
  id: user._id,
  userId: user.userId,
  name: user.name,
  role: user.role,
  email: user.email,
  mobile: user.mobile,
  designation: user.designation,
  school: user.school || null,
  block: user.block || null,
  dcOffice: user.dcOffice || null,
});

export const login = asyncHandler(async (req, res) => {
  const { userId, password } = req.body;

  const user = await User.findOne({ userId: userId.trim() })
    .select('+password')
    .populate('school')
    .populate('block')
    .populate('dcOffice');

  if (!user || !(await user.matchPassword(password))) {
    throw ApiError.unauthorized('Invalid User ID or password.');
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  await logAudit({ req, user, action: AUDIT_ACTIONS.LOGIN, detail: `Role: ${user.role}` });

  res.json({ success: true, token: signToken(user), user: shapeUser(user) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: shapeUser(req.user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.matchPassword(currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect.');
  }
  user.password = newPassword;
  await user.save();

  res.json({ success: true, message: 'Password updated.' });
});
