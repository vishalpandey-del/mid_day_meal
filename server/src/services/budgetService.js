import mongoose from 'mongoose';
import Budget from '../models/Budget.js';
import Claim from '../models/Claim.js';
import Config from '../models/Config.js';
import { CLAIM_STATUS } from '../config/constants.js';

/** Claims that have consumed budget: approved, or still moving toward approval. */
const CONSUMING_STATUSES = [
  CLAIM_STATUS.PENDING_CHECKER,
  CLAIM_STATUS.PENDING_BLOCK,
  CLAIM_STATUS.SUBMITTED,
  CLAIM_STATUS.UNDER_QUERY,
  CLAIM_STATUS.RESUBMITTED,
  CLAIM_STATUS.APPROVED,
];

export const currentFy = () => Budget.fyLabel();

/**
 * Aggregation $match does not cast strings to ObjectIds the way find() does,
 * so every id reaching a pipeline is normalised here first.
 */
const oid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v._id || v)));

/** Start/end of an Indian financial year label, e.g. "2026-27". */
export const fyRange = (label) => {
  const startYear = Number(String(label).slice(0, 4));
  return { from: new Date(startYear, 3, 1), to: new Date(startYear + 1, 2, 31, 23, 59, 59, 999) };
};

/**
 * Allocated vs consumed for one school, in one FY, optionally for one head.
 * `committed` counts claims still in flight; `approved` counts only approved.
 */
export const schoolBudgetStatus = async ({ schoolId, financialYear, budgetHead }) => {
  const fy = financialYear || currentFy();
  schoolId = oid(schoolId);
  const { from, to } = fyRange(fy);

  const budgetFilter = { level: 'school', school: schoolId, financialYear: fy };
  if (budgetHead) budgetFilter.budgetHead = budgetHead;

  const claimFilter = {
    school: schoolId,
    billDate: { $gte: from, $lte: to },
    status: { $in: CONSUMING_STATUSES },
  };
  if (budgetHead) claimFilter.budgetHead = budgetHead;

  const [budgets, spend] = await Promise.all([
    Budget.find(budgetFilter).lean(),
    Claim.aggregate([
      { $match: claimFilter },
      {
        $group: {
          _id: '$budgetHead',
          committed: { $sum: '$amount' },
          approved: {
            $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, '$amount', 0] },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const spendByHead = new Map(spend.map((s) => [s._id, s]));
  const heads = new Set([...budgets.map((b) => b.budgetHead), ...spendByHead.keys()]);

  const rows = [...heads].map((head) => {
    const allocated = budgets
      .filter((b) => b.budgetHead === head)
      .reduce((sum, b) => sum + b.allocated, 0);
    const s = spendByHead.get(head) || { committed: 0, approved: 0, count: 0 };
    return {
      budgetHead: head,
      allocated,
      committed: s.committed,
      approved: s.approved,
      available: allocated - s.committed,
      claims: s.count,
      utilisation: allocated ? Number(((s.committed / allocated) * 100).toFixed(1)) : null,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      allocated: t.allocated + r.allocated,
      committed: t.committed + r.committed,
      approved: t.approved + r.approved,
      available: t.available + r.available,
    }),
    { allocated: 0, committed: 0, approved: 0, available: 0 }
  );

  return { financialYear: fy, rows: rows.sort((a, b) => b.committed - a.committed), totals };
};

/**
 * Checks a proposed claim against the school's remaining allocation.
 * Warn-only by default: returns a warning rather than throwing.
 */
export const checkBudgetFor = async ({ schoolId, budgetHead, amount, billDate }) => {
  schoolId = oid(schoolId);
  const cfg = await Config.getGlobal();
  if (!cfg.budget?.warnOnOverspend && !cfg.budget?.blockOnOverspend) return null;

  const fy = Budget.fyLabel(billDate || new Date());
  const { rows } = await schoolBudgetStatus({ schoolId, financialYear: fy, budgetHead });
  const row = rows.find((r) => r.budgetHead === budgetHead);

  // No allocation on record — nothing to measure against.
  if (!row || !row.allocated) {
    return {
      level: 'info',
      budgetHead,
      financialYear: fy,
      allocated: 0,
      available: 0,
      message: `No ${fy} allocation is on record for ${budgetHead}. This claim is not counted against any budget.`,
    };
  }

  const availableAfter = row.available - Number(amount || 0);
  if (availableAfter >= 0) {
    return {
      level: 'ok',
      budgetHead,
      financialYear: fy,
      allocated: row.allocated,
      available: row.available,
      availableAfter,
    };
  }

  return {
    level: 'warning',
    budgetHead,
    financialYear: fy,
    allocated: row.allocated,
    available: row.available,
    overBy: Math.abs(availableAfter),
    message: `This claim exceeds the remaining ${budgetHead} allocation for ${fy} by ₹${Math.abs(
      availableAfter
    ).toLocaleString('en-IN')}.`,
  };
};

/** Allocated vs consumed for one DC office, aggregated over its schools. */
export const dcBudgetStatus = async ({ dcOfficeId, financialYear }) => {
  const fy = financialYear || currentFy();
  dcOfficeId = oid(dcOfficeId);
  const { from, to } = fyRange(fy);

  const [received, distributed, spend] = await Promise.all([
    Budget.find({ level: 'dc', dcOffice: dcOfficeId, financialYear: fy }).lean(),
    Budget.aggregate([
      { $match: { level: 'school', parentDcOffice: dcOfficeId, financialYear: fy } },
      { $group: { _id: '$budgetHead', total: { $sum: '$allocated' }, schools: { $sum: 1 } } },
    ]),
    Claim.aggregate([
      {
        $match: {
          dcOffice: dcOfficeId,
          billDate: { $gte: from, $lte: to },
          status: { $in: CONSUMING_STATUSES },
        },
      },
      {
        $group: {
          _id: '$budgetHead',
          committed: { $sum: '$amount' },
          approved: {
            $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, '$amount', 0] },
          },
        },
      },
    ]),
  ]);

  const distMap = new Map(distributed.map((d) => [d._id, d]));
  const spendMap = new Map(spend.map((s) => [s._id, s]));
  const heads = new Set([
    ...received.map((r) => r.budgetHead),
    ...distMap.keys(),
    ...spendMap.keys(),
  ]);

  const rows = [...heads].map((head) => {
    const allocated = received
      .filter((r) => r.budgetHead === head)
      .reduce((sum, r) => sum + r.allocated, 0);
    const dist = distMap.get(head) || { total: 0, schools: 0 };
    const sp = spendMap.get(head) || { committed: 0, approved: 0 };
    return {
      budgetHead: head,
      allocated,
      distributed: dist.total,
      schoolsFunded: dist.schools,
      undistributed: allocated - dist.total,
      committed: sp.committed,
      approved: sp.approved,
      utilisation: allocated ? Number(((sp.committed / allocated) * 100).toFixed(1)) : null,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      allocated: t.allocated + r.allocated,
      distributed: t.distributed + r.distributed,
      undistributed: t.undistributed + r.undistributed,
      committed: t.committed + r.committed,
      approved: t.approved + r.approved,
    }),
    { allocated: 0, distributed: 0, undistributed: 0, committed: 0, approved: 0 }
  );

  return { financialYear: fy, rows: rows.sort((a, b) => b.allocated - a.allocated), totals };
};

/**
 * A running ledger for one school: every bill that draws on the allocation,
 * with the balance after each one. This is what the school sees when it asks
 * "where did my money go".
 */
export const schoolBudgetLedger = async ({ schoolId, financialYear, budgetHead }) => {
  schoolId = oid(schoolId);
  const fy = financialYear || currentFy();
  const { from, to } = fyRange(fy);

  const budgetFilter = { level: 'school', school: schoolId, financialYear: fy };
  if (budgetHead) budgetFilter.budgetHead = budgetHead;

  const claimFilter = {
    school: schoolId,
    billDate: { $gte: from, $lte: to },
    status: { $in: CONSUMING_STATUSES },
  };
  if (budgetHead) claimFilter.budgetHead = budgetHead;

  const [budgets, claims] = await Promise.all([
    Budget.find(budgetFilter).lean(),
    Claim.find(claimFilter)
      .select('claimId category budgetHead amount status paymentStatus billDate createdAt')
      .sort({ billDate: 1, createdAt: 1 })
      .lean(),
  ]);

  // Opening balance per head, drawn down bill by bill.
  const opening = {};
  for (const b of budgets) {
    opening[b.budgetHead] = (opening[b.budgetHead] || 0) + b.allocated;
  }

  const running = { ...opening };
  const entries = claims.map((c) => {
    const before = running[c.budgetHead] ?? 0;
    const after = before - c.amount;
    running[c.budgetHead] = after;
    return {
      claimId: c.claimId,
      category: c.category,
      budgetHead: c.budgetHead,
      billDate: c.billDate,
      amount: c.amount,
      status: c.status,
      paymentStatus: c.paymentStatus,
      balanceBefore: before,
      balanceAfter: after,
      // A head with no allocation cannot be drawn down meaningfully.
      unbudgeted: !(c.budgetHead in opening),
    };
  });

  const totals = {
    allocated: Object.values(opening).reduce((a, b) => a + b, 0),
    spent: claims.reduce((a, c) => a + c.amount, 0),
  };
  totals.available = totals.allocated - totals.spent;

  return { financialYear: fy, opening, entries, totals };
};
