import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { ROLES, SCHOOL_ROLES } from '../config/constants.js';

/**
 * Creates in-app notifications. Email/SMS are recorded as intended channels —
 * wire a real gateway (NIC DLT / SMTP) into `dispatchExternal` for production.
 */
export const notify = async ({ recipients, icon, title, body, claim, channels = ['in_app', 'email', 'sms'] }) => {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const ids = list.filter(Boolean).map((r) => r._id || r);
  if (!ids.length) return [];

  const docs = await Notification.insertMany(
    ids.map((recipient) => ({
      recipient,
      icon,
      title,
      body,
      claim: claim?._id || null,
      claimId: claim?.claimId || '',
      channels,
    }))
  );

  await dispatchExternal({ ids, title, body, channels });
  return docs;
};

/** Stub for SMS/Email gateways — logs the intent so the demo shows the channel. */
const dispatchExternal = async ({ ids, title, channels }) => {
  const outbound = channels.filter((c) => c !== 'in_app');
  if (!outbound.length) return;
  console.log(`[notify] ${outbound.join('+')} → ${ids.length} recipient(s): ${title}`);
};

/** Resolve the users who should hear about a claim event. */

/** Both maker and checker at a school. */
export const recipientsForSchool = (schoolId) =>
  User.find({ role: { $in: SCHOOL_ROLES }, school: schoolId, isActive: true }).select('_id');

/** A specific role, optionally narrowed by school / block / DC office. */
export const recipientsForRole = (role, scope = {}) =>
  User.find({ role, isActive: true, ...scope }).select('_id');

export const recipientsForBlock = (blockId) =>
  User.find({ role: ROLES.BLOCK, block: blockId, isActive: true }).select('_id');

export const recipientsForDc = (dcOfficeId) =>
  User.find({ role: ROLES.DC, dcOffice: dcOfficeId, isActive: true }).select('_id');

export const recipientsForState = () =>
  User.find({ role: ROLES.STATE, isActive: true }).select('_id');
