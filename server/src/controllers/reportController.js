import Claim from '../models/Claim.js';
import School from '../models/School.js';
import AuditLog from '../models/AuditLog.js';
import Config from '../models/Config.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { claimScope, toObjectId } from '../utils/scope.js';
import { logAudit } from '../services/auditService.js';
import { buildWorkbook, buildBeneficiaryWorkbook, sendWorkbook, SHEET_NAME } from '../services/excelService.js';
import { AUDIT_ACTIONS, CLAIM_STATUS, PAYABLE_STATES, PAYMENT_STATUS, ROLES } from '../config/constants.js';
import { todayStamp } from '../utils/format.js';

/** Shared query builder so exports match exactly what the user filtered on screen. */
const buildFilter = async (req) => {
  const { status, category, budgetHead, block, school, paymentStatus, from, to } = req.query;
  const filter = { ...claimScope(req.user) };

  if (status) filter.status = { $in: String(status).split(',') };
  if (category) filter.category = category;
  if (budgetHead) filter.budgetHead = budgetHead;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (school && !filter.school) filter.school = toObjectId(school);
  if (block && !filter.block && !filter.school) filter.block = toObjectId(block);

  if (from || to) {
    filter.billDate = {};
    if (from) filter.billDate.$gte = new Date(from);
    if (to) filter.billDate.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  return filter;
};

const fetchClaims = (filter) =>
  Claim.find(filter)
    .populate('school', 'name code block district bank gstin')
    .populate('block', 'name code')
    .populate('dcOffice', 'name code')
    .populate('submittedBy', 'name userId')
    .sort({ createdAt: -1 });

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/**
 * GET /api/reports/claims.xlsx — the general claim register.
 */
export const exportClaims = asyncHandler(async (req, res) => {
  const filter = await buildFilter(req);
  const claims = await fetchClaims(filter);

  const headers = [
    'Claim ID', 'School Code', 'School Name', 'Block', 'Category', 'Budget Head',
    'Vendor', 'Vendor A/C No', 'Vendor IFSC', 'Bill No', 'Bill Date', 'Amount (₹)',
    'Status', 'Payment', 'Submitted On', 'Decided On', 'Age (days)', 'DC Remarks',
  ];

  const rows = claims.map((c) => [
    c.claimId,
    c.school?.code || '',
    c.school?.name || '',
    c.block?.name || c.school?.block || '',
    c.category,
    c.budgetHead,
    c.vendorName,
    c.vendorBankAccount || '',
    c.vendorIfsc || '',
    c.billNumber,
    dateOnly(c.billDate),
    c.amount,
    c.status,
    c.status === CLAIM_STATUS.APPROVED
      ? c.paymentStatus + (c.reversalCount ? ` (reversed ${c.reversalCount}x)` : '')
      : '',
    dateOnly(c.submittedAt),
    dateOnly(c.decidedAt),
    c.ageDays,
    c.dcRemarks || '',
  ]);

  const wb = buildWorkbook({
    headers,
    rows,
    title: `Vidyaposhan · Claim Register · ${todayStamp()}`,
  });
  wb.getWorksheet(SHEET_NAME).getColumn(12).numFmt = '#,##0.00';

  await logAudit({
    req,
    action: AUDIT_ACTIONS.EXPORT,
    detail: `Claim register — ${rows.length} row(s)`,
  });

  await sendWorkbook(res, wb, `vidyaposhan-claims-${todayStamp()}.xlsx`);
});

/**
 * GET /api/reports/beneficiary.xlsx — PFMS "Add Beneficiary Details" file.
 *
 * Only APPROVED claims are ever included: this file drives payment, so an
 * unapproved bill must never reach it. Every exported claim is stamped, and
 * from that point any status change requires an explicit remark.
 */
export const exportBeneficiary = asyncHandler(async (req, res) => {
  const filter = await buildFilter(req);

  // Approved-only is enforced, not merely defaulted.
  filter.status = CLAIM_STATUS.APPROVED;

  /*
   * The file follows the tab the DC is looking at. Standing on "Awaiting
   * Payment" exports what is awaiting payment, "Paid" exports what was paid,
   * "Payment Reversed" exports what bounced — and a bill that was paid and
   * then reversed is reversed, so it leaves the paid file and joins that one.
   * `paymentStatus` is a single state, never a set, so the two can't overlap.
   *
   * With no tab named, the default stays what it was: everything still owed
   * money. `includePaid=true` widens that to everything approved.
   */
  const tab = req.query.paymentStatus;
  if (tab) {
    if (!Object.values(PAYMENT_STATUS).includes(tab)) {
      throw ApiError.badRequest(
        `"${tab}" is not a payment state. Use ${Object.values(PAYMENT_STATUS).join(', ')}.`
      );
    }
    filter.paymentStatus = tab;
  } else if (req.query.includePaid !== 'true') {
    filter.paymentStatus = { $in: PAYABLE_STATES };
  }

  const claims = await fetchClaims(filter);
  if (!claims.length) {
    throw ApiError.badRequest(
      tab
        ? `No approved claims are sitting in "${tab}", so there is nothing to export.`
        : 'No approved claims match this filter, so there is nothing to export.'
    );
  }

  const missingBank = claims.filter((c) => !c.school?.bank?.accountNumber);
  if (missingBank.length) {
    throw ApiError.badRequest(
      `${missingBank.length} school(s) have no bank account on record. Fix the school master first.`,
      missingBank.slice(0, 10).map((c) => ({
        field: c.claimId,
        message: `${c.school?.name || 'Unknown school'} is missing bank details`,
      }))
    );
  }

  const slug = tab ? `-${tab.toLowerCase().replace(/\s+/g, '-')}` : '';
  const fileName = `pfms-beneficiary${slug}-${todayStamp()}.xlsx`;
  const wb = buildBeneficiaryWorkbook(claims);

  // Stamp the claims before streaming, so the record exists even if the
  // download is interrupted client-side.
  const now = new Date();
  await Claim.updateMany(
    { _id: { $in: claims.map((c) => c._id) } },
    {
      $set: { lastExportedAt: now },
      $push: {
        exportHistory: {
          exportedAt: now,
          exportedBy: req.user._id,
          exportedByName: req.user.name,
          fileName,
          statusAtExport: CLAIM_STATUS.APPROVED,
        },
      },
    }
  );

  await logAudit({
    req,
    action: AUDIT_ACTIONS.EXPORT,
    detail:
      `PFMS beneficiary file${tab ? ` (${tab})` : ''} — ${claims.length} approved claim(s) · ` +
      `${claims.map((c) => c.claimId).join(', ').slice(0, 500)}`,
  });

  await sendWorkbook(res, wb, fileName);
});

/**
 * GET /api/reports/sla.xlsx — claims pending with the DC, with ageing buckets.
 */
export const exportSlaReport = asyncHandler(async (req, res) => {
  const cfg = await Config.getGlobal();
  const base = claimScope(req.user);

  const claims = await fetchClaims({
    ...base,
    status: {
      $in: [CLAIM_STATUS.SUBMITTED, CLAIM_STATUS.RESUBMITTED, CLAIM_STATUS.UNDER_QUERY],
    },
  });

  const bucket = (age) =>
    age >= cfg.sla.breachDay ? 'Breached' : age >= cfg.sla.reminderDay ? 'Reminder' : 'Within SLA';

  const headers = [
    'Claim ID', 'School', 'Block', 'DC Office', 'Category', 'Amount (₹)',
    'Status', 'Submitted On', 'Age (days)', 'Paused (days)', 'SLA Bucket',
  ];

  const rows = claims
    .map((c) => [
      c.claimId,
      c.school?.name || '',
      c.block?.name || c.school?.block || '',
      c.dcOffice?.name || '',
      c.category,
      c.amount,
      c.status,
      dateOnly(c.submittedAt),
      c.ageDays,
      c.pausedDays || 0,
      bucket(c.ageDays),
    ])
    .sort((a, b) => b[8] - a[8]);

  const wb = buildWorkbook({
    headers,
    rows,
    title: `Vidyaposhan · SLA Monitor · reminder ${cfg.sla.reminderDay}d / breach ${cfg.sla.breachDay}d`,
  });
  wb.getWorksheet(SHEET_NAME).getColumn(6).numFmt = '#,##0.00';

  await logAudit({ req, action: AUDIT_ACTIONS.EXPORT, detail: `SLA report — ${rows.length} row(s)` });

  await sendWorkbook(res, wb, `vidyaposhan-sla-${todayStamp()}.xlsx`);
});

/**
 * GET /api/reports/block-summary.xlsx — block-wise consolidated statement.
 */
export const exportBlockSummary = asyncHandler(async (req, res) => {
  const base = claimScope(req.user);

  const agg = await Claim.aggregate([
    { $match: base },
    { $lookup: { from: 'blocks', localField: 'block', foreignField: '_id', as: 'blk' } },
    { $unwind: { path: '$blk', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { $ifNull: ['$blk.name', 'Unassigned'] },
        schools: { $addToSet: '$school' },
        claims: { $sum: 1 },
        amount: { $sum: '$amount' },
        approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
        approvedAmount: {
          $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, '$amount', 0] },
        },
        rejected: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.REJECTED] }, 1, 0] } },
        paidAmount: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.PAID] }, '$amount', 0] },
        },
      },
    },
    { $sort: { amount: -1 } },
  ]);

  const headers = [
    'Block', 'Schools', 'Total Claims', 'Total Amount (₹)',
    'Approved', 'Approved Amount (₹)', 'Paid Amount (₹)', 'Rejected', 'Approval Rate (%)',
  ];

  const rows = agg.map((r) => {
    const decided = r.approved + r.rejected;
    return [
      r._id,
      r.schools.length,
      r.claims,
      r.amount,
      r.approved,
      r.approvedAmount,
      r.paidAmount,
      r.rejected,
      decided ? Number(((r.approved / decided) * 100).toFixed(1)) : 0,
    ];
  });

  const wb = buildWorkbook({
    headers,
    rows,
    title: `Vidyaposhan · Block-wise Summary · ${todayStamp()}`,
  });
  const ws = wb.getWorksheet(SHEET_NAME);
  [4, 6, 7].forEach((col) => { ws.getColumn(col).numFmt = '#,##0.00'; });

  await logAudit({ req, action: AUDIT_ACTIONS.EXPORT, detail: `Block summary — ${rows.length} block(s)` });

  await sendWorkbook(res, wb, `vidyaposhan-block-summary-${todayStamp()}.xlsx`);
});

/**
 * GET /api/reports/audit.xlsx — exportable audit trail (State / Admin).
 */
export const exportAuditLog = asyncHandler(async (req, res) => {
  const { from, to, action } = req.query;
  const filter = {};
  if (action) filter.action = action;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(20000);

  const headers = ['Timestamp', 'User', 'User ID', 'Role', 'Action', 'Claim ID', 'Detail', 'IP'];
  const rows = logs.map((l) => [
    new Date(l.createdAt).toLocaleString('en-IN'),
    l.userName,
    l.userId,
    l.role,
    l.action,
    l.claimId,
    l.detail,
    l.ip,
  ]);

  const wb = buildWorkbook({
    headers,
    rows,
    title: `Vidyaposhan · Audit Trail · ${todayStamp()}`,
  });

  await logAudit({ req, action: AUDIT_ACTIONS.EXPORT, detail: `Audit trail — ${rows.length} entries` });

  await sendWorkbook(res, wb, `vidyaposhan-audit-${todayStamp()}.xlsx`);
});
