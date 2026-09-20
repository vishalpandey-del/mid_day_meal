import AuditLog from '../models/AuditLog.js';

const clientIp = (req) =>
  (req?.headers?.['x-forwarded-for']?.split(',')[0] || req?.ip || '').replace('::ffff:', '');

export const logAudit = async ({ req, user, action, claimId = '', detail = '' }) => {
  const actor = user || req?.user;
  try {
    await AuditLog.create({
      user: actor?._id,
      userName: actor?.name || 'System',
      userId: actor?.userId || '',
      role: actor?.role || 'system',
      action,
      claimId,
      detail,
      ip: clientIp(req),
      userAgent: req?.headers?.['user-agent'] || '',
    });
  } catch (err) {
    // Audit must never break the request it is recording.
    console.error('[audit] failed to write entry:', err.message);
  }
};
