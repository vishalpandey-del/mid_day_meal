import mongoose from 'mongoose';
import ApiError from './ApiError.js';
import { ROLES, SCHOOL_ROLES } from '../config/constants.js';

/**
 * Aggregation $match does not cast id strings the way find() does, and the
 * same scope object feeds both, so ids are normalised once here.
 */
export const toObjectId = (v) => {
  if (!v) return v;
  if (v instanceof mongoose.Types.ObjectId) return v;
  const raw = String(v._id || v);
  return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : v;
};

/**
 * Narrows any claim query to what the caller's role may see.
 * School roles see their school, block sees its block, DC sees its office,
 * State and Admin see everything.
 */
export const claimScope = (user) => {
  if (SCHOOL_ROLES.includes(user.role)) {
    if (!user.school) throw ApiError.forbidden('Your account is not linked to a school.');
    return { school: toObjectId(user.school) };
  }
  if (user.role === ROLES.BLOCK) {
    if (!user.block) throw ApiError.forbidden('Your account is not linked to a block.');
    return { block: toObjectId(user.block) };
  }
  if (user.role === ROLES.DC) {
    if (!user.dcOffice) throw ApiError.forbidden('Your account is not linked to a DC office.');
    return { dcOffice: toObjectId(user.dcOffice) };
  }
  return {};
};

/** Throws unless the caller is allowed to touch this specific claim. */
export const assertCanView = (claim, user) => {
  const id = (v) => String(v?._id || v || '');

  if (SCHOOL_ROLES.includes(user.role) && id(claim.school) !== id(user.school)) {
    throw ApiError.forbidden('This claim belongs to another school.');
  }
  if (user.role === ROLES.BLOCK && id(claim.block) !== id(user.block)) {
    throw ApiError.forbidden('This claim is not routed to your block.');
  }
  if (user.role === ROLES.DC && id(claim.dcOffice) !== id(user.dcOffice)) {
    throw ApiError.forbidden('This claim is not routed to your office.');
  }
};

/** Escapes user input before it is used inside a RegExp. */
export const safeRegex = (value, flags = 'i') =>
  new RegExp(String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
