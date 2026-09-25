import mongoose from 'mongoose';
import Claim from '../models/Claim.js';
import School from '../models/School.js';
import User from '../models/User.js';
import Config from '../models/Config.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { claimScope, safeRegex } from '../utils/scope.js';
import { dcBudgetStatus, schoolBudgetStatus, currentFy } from '../services/budgetService.js';
import { CLAIM_STATUS, PAYABLE_STATES, PAYMENT_STATUS, ROLES, SCHOOL_ROLES } from '../config/constants.js';

/** Claims still moving through the chain. */
const OPEN_STATUSES = [
  CLAIM_STATUS.PENDING_CHECKER,
  CLAIM_STATUS.PENDING_BLOCK,
  CLAIM_STATUS.SUBMITTED,
  CLAIM_STATUS.UNDER_QUERY,
  CLAIM_STATUS.RESUBMITTED,
  CLAIM_STATUS.RETURNED,
];

/** The status that sits in each role's own action queue. */
const QUEUE_FOR_ROLE = {
  [ROLES.SCHOOL_MAKER]: [CLAIM_STATUS.DRAFT, CLAIM_STATUS.RETURNED, CLAIM_STATUS.UNDER_QUERY],
  [ROLES.SCHOOL_CHECKER]: [CLAIM_STATUS.PENDING_CHECKER],
  // The block carries no action queue; it watches its schools instead.
  [ROLES.BLOCK]: [],
  [ROLES.DC]: [CLAIM_STATUS.SUBMITTED, CLAIM_STATUS.RESUBMITTED, CLAIM_STATUS.UNDER_QUERY],
};

/**
 * GET /api/dashboard
 * One call powers the landing screen: KPI tiles, status split, category split,
 * a 6-month trend, SLA ageing and the caller's own action queue size.
 */
export const getDashboard = asyncHandler(async (req, res) => {
  const base = claimScope(req.user);

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  // Everything below is independent, so it goes out together. Each extra
  // sequential await costs a full round trip to Atlas, which dominates the
  // response time once the queries themselves are indexed.
  const myQueueStatuses = QUEUE_FOR_ROLE[req.user.role];

  const [cfg, byStatus, byCategory, byHead, trend, totals, open, myQueue] = await Promise.all([
    Config.getGlobal(),
    Claim.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      { $sort: { count: -1 } },
    ]),
    Claim.aggregate([
      { $match: base },
      { $group: { _id: '$category', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
    ]),
    Claim.aggregate([
      { $match: base },
      { $group: { _id: '$budgetHead', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
    ]),
    Claim.aggregate([
      { $match: { ...base, createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
          approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
        },
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]),
    Claim.aggregate([
      { $match: base },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          approvedAmount: {
            $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, '$amount', 0] },
          },
          pending: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
          pendingAmount: {
            $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, '$amount', 0] },
          },
          paid: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', CLAIM_STATUS.APPROVED] },
                    { $eq: ['$paymentStatus', PAYMENT_STATUS.PAID] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          paidAmount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.PAID] }, '$amount', 0],
            },
          },
          reversed: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.REVERSED] }, 1, 0],
            },
          },
          reversedAmount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.REVERSED] }, '$amount', 0],
            },
          },
        },
      },
    ]),
    // Ageing reuses the ageDays virtual, so these stay as documents.
    Claim.find({
      ...base,
      status: { $in: [CLAIM_STATUS.SUBMITTED, CLAIM_STATUS.RESUBMITTED, CLAIM_STATUS.UNDER_QUERY] },
    })
      .select('claimId status submittedAt queryRaisedAt pausedDays amount school')
      .populate('school', 'name code block'),
    myQueueStatuses
      ? Claim.countDocuments({ ...base, status: { $in: myQueueStatuses } })
      : Promise.resolve(0),
  ]);

  const { reminderDay, breachDay } = cfg.sla;

  const ageing = { normal: 0, reminder: 0, breached: 0 };
  const breaching = [];
  for (const c of open) {
    const age = c.ageDays;
    if (age >= breachDay) {
      ageing.breached++;
      breaching.push({
        claimId: c.claimId,
        school: c.school?.name,
        block: c.school?.block,
        status: c.status,
        amount: c.amount,
        ageDays: age,
      });
    } else if (age >= reminderDay) {
      ageing.reminder++;
    } else {
      ageing.normal++;
    }
  }
  breaching.sort((a, b) => b.ageDays - a.ageDays);

  const t = totals[0] || {};
  const statusMap = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));

  const approved = statusMap[CLAIM_STATUS.APPROVED] || 0;
  const rejected = statusMap[CLAIM_STATUS.REJECTED] || 0;
  const decided = approved + rejected;

  const payload = {
    success: true,
    role: req.user.role,
    kpis: {
      total: t.total || 0,
      totalAmount: t.totalAmount || 0,
      pending: t.pending || 0,
      pendingAmount: t.pendingAmount || 0,
      approved,
      approvedAmount: t.approvedAmount || 0,
      rejected,
      drafts: statusMap[CLAIM_STATUS.DRAFT] || 0,
      returned: statusMap[CLAIM_STATUS.RETURNED] || 0,
      underQuery: statusMap[CLAIM_STATUS.UNDER_QUERY] || 0,
      pendingChecker: statusMap[CLAIM_STATUS.PENDING_CHECKER] || 0,
      pendingBlock: statusMap[CLAIM_STATUS.PENDING_BLOCK] || 0,
      paid: t.paid || 0,
      paidAmount: t.paidAmount || 0,
      reversed: t.reversed || 0,
      reversedAmount: t.reversedAmount || 0,
      // Still owed money: never paid, plus anything that bounced back.
      unpaidApproved: approved - (t.paid || 0),
      approvalRate: decided ? Number(((approved / decided) * 100).toFixed(1)) : 0,
      myQueue,
    },
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count, amount: s.amount })),
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.count, amount: c.amount })),
    byBudgetHead: byHead.map((h) => ({ budgetHead: h._id, count: h.count, amount: h.amount })),
    trend: trend.map((r) => ({
      month: `${r._id.y}-${String(r._id.m).padStart(2, '0')}`,
      count: r.count,
      amount: r.amount,
      approved: r.approved,
    })),
    ageing,
    breaching: breaching.slice(0, 10),
    sla: cfg.sla,
  };

  // Pie-chart series for the State dashboard.
  if ([ROLES.STATE, ROLES.ADMIN].includes(req.user.role)) {
    payload.pie = {
      byStatus: payload.byStatus.map((s) => ({ label: s.status, value: s.count, amount: s.amount })),
      byCategory: payload.byCategory.map((c) => ({
        label: c.category,
        value: c.amount,
        count: c.count,
      })),
      byBudgetHead: payload.byBudgetHead.map((h) => ({
        label: h.budgetHead,
        value: h.amount,
        count: h.count,
      })),
      payment: [
        { label: 'Paid', value: t.paid || 0, amount: t.paidAmount || 0 },
        {
          label: 'Awaiting payment',
          value: approved - (t.paid || 0) - (t.reversed || 0),
          amount: (t.approvedAmount || 0) - (t.paidAmount || 0) - (t.reversedAmount || 0),
        },
        { label: 'Payment Reversed', value: t.reversed || 0, amount: t.reversedAmount || 0 },
      ],
    };

    payload.byDistrict = await Claim.aggregate([
      { $lookup: { from: 'dcoffices', localField: 'dcOffice', foreignField: '_id', as: 'dc' } },
      { $unwind: '$dc' },
      {
        $group: {
          _id: '$dc.name',
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
          approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
        },
      },
      { $sort: { amount: -1 } },
    ]).then((rows) =>
      rows.map((r) => ({ dcOffice: r._id, count: r.count, amount: r.amount, approved: r.approved }))
    );
  }

  // The DC also gets its budget position on the landing screen.
  if (req.user.role === ROLES.DC && req.user.dcOffice) {
    payload.budget = await dcBudgetStatus({
      dcOfficeId: req.user.dcOffice._id || req.user.dcOffice,
      financialYear: currentFy(),
    });
  }

  res.json(payload);
});

/**
 * GET /api/dashboard/blocks — block-wise rollup for DC / State tables.
 */
export const getBlockSummary = asyncHandler(async (req, res) => {
  const base = claimScope(req.user);

  const rows = await Claim.aggregate([
    { $match: base },
    { $lookup: { from: 'blocks', localField: 'block', foreignField: '_id', as: 'blk' } },
    { $unwind: { path: '$blk', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { id: '$block', name: '$blk.name' },
        claims: { $sum: 1 },
        amount: { $sum: '$amount' },
        approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
        approvedAmount: {
          $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, '$amount', 0] },
        },
        pending: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
        schools: { $addToSet: '$school' },
      },
    },
    {
      $project: {
        _id: 0,
        blockId: '$_id.id',
        block: { $ifNull: ['$_id.name', 'Unassigned'] },
        claims: 1,
        amount: 1,
        approved: 1,
        approvedAmount: 1,
        pending: 1,
        schools: { $size: '$schools' },
      },
    },
    { $sort: { amount: -1 } },
  ]);

  res.json({ success: true, blocks: rows });
});

/**
 * GET /api/dashboard/queue — the caller's own action queue, oldest first.
 * Replaces the old "pending claims" view; every role gets its own stage.
 */
export const getMyQueue = asyncHandler(async (req, res) => {
  const base = claimScope(req.user);
  const cfg = await Config.getGlobal();

  const statuses = QUEUE_FOR_ROLE[req.user.role];
  if (!statuses) {
    return res.json({ success: true, count: 0, claims: [], note: 'This role has no action queue.' });
  }

  const claims = await Claim.find({ ...base, status: { $in: statuses } })
    .populate('school', 'name code block')
    .populate('block', 'name code')
    .populate('submittedBy', 'name userId')
    .sort({ submittedAt: 1, createdAt: 1 });

  const withAge = claims.map((c) => {
    const o = c.toJSON();
    o.slaBucket =
      o.ageDays >= cfg.sla.breachDay
        ? 'breached'
        : o.ageDays >= cfg.sla.reminderDay
        ? 'reminder'
        : 'normal';
    return o;
  });

  /*
   * The same claims, gathered into batches — one per school and scheme.
   *
   * A school usually sends several bills against the same scheme in a month,
   * and the district decides them together: same head teacher, same budget
   * head, same question. Deciding them one screen at a time is the same work
   * done ten times. Grouping here rather than on the client keeps the two
   * views showing the same set, and a batch of one is still listed so nothing
   * hides from the count.
   */
  const batches = [...withAge.reduce((map, c) => {
    const schoolId = String(c.school?._id || c.school);
    const key = `${schoolId}::${c.category}`;
    const batch = map.get(key) || {
      key,
      school: c.school,
      category: c.category,
      budgetHead: c.budgetHead,
      claims: [],
      total: 0,
      oldestDays: 0,
      breached: 0,
    };
    batch.claims.push(c);
    batch.total += c.amount;
    batch.oldestDays = Math.max(batch.oldestDays, c.ageDays || 0);
    if (c.slaBucket === 'breached') batch.breached += 1;
    map.set(key, batch);
    return map;
  }, new Map()).values()]
    // The district works oldest-first, and a bigger group is worth more of
    // one sitting than a single bill of the same age.
    .sort((a, b) => b.oldestDays - a.oldestDays || b.claims.length - a.claims.length)
    .map((b) => ({ ...b, count: b.claims.length }));

  res.json({
    success: true,
    stage: statuses,
    count: withAge.length,
    claims: withAge,
    batches,
    batchCount: batches.length,
  });
});

/**
 * GET /api/dashboard/school/:id — per-school drilldown.
 */
export const getSchoolSummary = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid school id.');

  const school = await School.findById(id)
    .populate('dcOffice', 'name code')
    .populate('blockRef', 'name code');
  if (!school) throw ApiError.notFound('School not found.');

  if (
    SCHOOL_ROLES.includes(req.user.role) &&
    String(school._id) !== String(req.user.school?._id || req.user.school)
  ) {
    throw ApiError.forbidden('You can only view your own school.');
  }
  if (
    req.user.role === ROLES.BLOCK &&
    String(school.blockRef?._id) !== String(req.user.block?._id || req.user.block)
  ) {
    throw ApiError.forbidden('This school is not in your block.');
  }
  if (
    req.user.role === ROLES.DC &&
    String(school.dcOffice?._id) !== String(req.user.dcOffice?._id || req.user.dcOffice)
  ) {
    throw ApiError.forbidden('This school is not mapped to your office.');
  }

  const [summary] = await Claim.aggregate([
    { $match: { school: school._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        totalAmount: { $sum: '$amount' },
        approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
        approvedAmount: {
          $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, '$amount', 0] },
        },
        pending: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
        paidAmount: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.PAID] }, '$amount', 0] },
        },
      },
    },
  ]);

  /*
   * Opening a school should answer the questions asked of one: what it has
   * claimed, what is still owed to it, and who signs in for it. The claim
   * list is paged rather than a fixed ten, because a busy school has dozens
   * and "recent" hid the rest with no way to reach them.
   */
  const perPage = Math.min(Number(req.query.limit) || 25, 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const claimFilter = { school: school._id };
  if (req.query.status) claimFilter.status = req.query.status;
  if (req.query.q) {
    const rx = safeRegex(req.query.q);
    claimFilter.$or = [{ claimId: rx }, { vendorName: rx }, { billNumber: rx }];
  }

  const [claims, claimTotal, logins, budget] = await Promise.all([
    Claim.find(claimFilter)
      .select('claimId category budgetHead amount status paymentStatus billDate submittedAt vendorName billNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage),
    Claim.countDocuments(claimFilter),
    User.find({ school: school._id })
      .select('userId name role designation isActive lastLoginAt mobile')
      .sort({ role: 1 }),
    schoolBudgetStatus({ schoolId: school._id }).catch(() => null),
  ]);

  res.json({
    success: true,
    school,
    summary:
      summary || {
        total: 0, totalAmount: 0, approved: 0, approvedAmount: 0, pending: 0, paidAmount: 0,
      },
    claims,
    claimTotal,
    page,
    pages: Math.ceil(claimTotal / perPage) || 1,
    logins,
    budget,
    // Kept so an older client that still reads `recent` does not break.
    recent: claims,
  });
});
