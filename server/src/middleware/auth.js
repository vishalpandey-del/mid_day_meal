import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';

export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('No token provided. Please sign in.');

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('Session expired or token invalid. Please sign in again.');
  }

  const user = await User.findById(decoded.id)
    .populate('school')
    .populate('block')
    .populate('dcOffice');
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not found or deactivated.');

  req.user = user;
  next();
});

/** Role gate — usage: authorize('dc', 'admin') */
export const authorize = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden(`This action requires role: ${roles.join(' or ')}.`));
  }
  next();
};
