import Budget from '../models/Budget.js';
import School from '../models/School.js';
import DcOffice from '../models/DcOffice.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import { notify, recipientsForDc, recipientsForSchool } from '../services/notificationService.js';
import {
  schoolBudgetStatus,
  schoolBudgetLedger,
  dcBudgetStatus,
  currentFy,
} from '../services/budgetService.js';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import { inr } from '../utils/format.js';

/**
 * Upserts an allocation, keeping a revision trail when the amount changes.
 */
const upsertAllocation = async ({ query, amount, note, user }) => {
  const existing = await Budget.findOne(query);

  if (!existing) {
    return {
      doc: await Budget.create({ ...query, allocated: amount, note, allocatedBy: user._id }),
      revised: false,
      previous: 0,
    };
  }

  const previous = existing.allocated;
  if (previous !== amount) {
    existing.revisions.push({
      amount,
      previousAmount: previous,
      by: user.name,
      byUser: user._id,
      note,
      at: new Date(),
    });
  }
  existing.allocated = amount;
  existing.note = note;
  existing.allocatedBy = user._id;
  await existing.save();

  return { doc: existing, revised: previous !== amount, previous };
};

/* ------------------------------------------------------------------ *
 * State → DC
 * ------------------------------------------------------------------ */

/** POST /api/budget/dc — State allocates a budget head to a DC office. */
export const allocateToDc = asyncHandler(async (req, res) => {
  const { dcOffice, budgetHead, allocated, financialYear, note = '' } = req.body;

  const office = await DcOffice.findById(dcOffice);
  if (!office) throw ApiError.notFound('DC office not found.');

  const fy = financialYear || currentFy();
  const { doc, revised, previous } = await upsertAllocation({
    query: { level: 'dc', dcOffice: office._id, school: null, financialYear: fy, budgetHead },
    amount: allocated,
    note,
    user: req.user,
  });

  await logAudit({
    req,
    action: revised ? AUDIT_ACTIONS.BUDGET_REVISED : AUDIT_ACTIONS.BUDGET_ALLOCATED,
    detail: `${office.name} · ${budgetHead} · ${fy} · ${inr(allocated)}${
      revised ? ` (was ${inr(previous)})` : ''
    }`,
  });

  await notify({
    recipients: await recipientsForDc(office._id),
    icon: '💰',
    title: `Budget ${revised ? 'revised' : 'allocated'} — ${budgetHead}`,
    body: `${inr(allocated)} for ${fy}. ${note}`.trim(),
    channels: ['in_app', 'email'],
  });

  res.status(revised ? 200 : 201).json({ success: true, budget: doc, revised, previous });
});

/* ------------------------------------------------------------------ *
 * DC → School
 * ------------------------------------------------------------------ */

/**
 * POST /api/budget/school — DC allocates to one of its schools.
 * The school must belong to the caller's office, and the office cannot
 * distribute more than the State gave it for that head.
 */
export const allocateToSchool = asyncHandler(async (req, res) => {
  const { school, budgetHead, allocated, financialYear, note = '' } = req.body;

  const target = await School.findById(school);
  if (!target) throw ApiError.notFound('School not found.');

  const dcOfficeId = req.user.dcOffice?._id || req.user.dcOffice;
  if (req.user.role === ROLES.DC && String(target.dcOffice) !== String(dcOfficeId)) {
    throw ApiError.forbidden('This school is not mapped to your office.');
  }

  const parentDc = target.dcOffice;
  const fy = financialYear || currentFy();

  // Guard against over-distribution of what this office actually received.
  const [received, alreadyGiven] = await Promise.all([
    Budget.findOne({ level: 'dc', dcOffice: parentDc, financialYear: fy, budgetHead }).lean(),
    Budget.aggregate([
      {
        $match: {
          level: 'school',
          parentDcOffice: parentDc,
          financialYear: fy,
          budgetHead,
          school: { $ne: target._id },
        },
      },
      { $group: { _id: null, total: { $sum: '$allocated' } } },
    ]),
  ]);

  const pool = received?.allocated || 0;
  const givenToOthers = alreadyGiven[0]?.total || 0;
  const remaining = pool - givenToOthers;

  if (pool && allocated > remaining) {
    throw ApiError.badRequest(
      `Only ${inr(remaining)} of the ${budgetHead} allocation for ${fy} is left to distribute. ` +
        `Requested: ${inr(allocated)}.`
    );
  }

  const { doc, revised, previous } = await upsertAllocation({
    query: {
      level: 'school',
      school: target._id,
      dcOffice: null,
      parentDcOffice: parentDc,
      financialYear: fy,
      budgetHead,
    },
    amount: allocated,
    note,
    user: req.user,
  });

  await logAudit({
    req,
    action: revised ? AUDIT_ACTIONS.BUDGET_REVISED : AUDIT_ACTIONS.BUDGET_ALLOCATED,
    detail: `${target.name} · ${budgetHead} · ${fy} · ${inr(allocated)}${
      revised ? ` (was ${inr(previous)})` : ''
    }`,
  });

  await notify({
    recipients: await recipientsForSchool(target._id),
    icon: '💰',
    title: `Budget ${revised ? 'revised' : 'allocated'} — ${budgetHead}`,
    body: `${inr(allocated)} for ${fy}. ${note}`.trim(),
    channels: ['in_app', 'email'],
  });

  res.status(revised ? 200 : 201).json({
    success: true,
    budget: doc,
    revised,
    previous,
    poolRemaining: pool ? remaining - allocated : null,
  });
});

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/** GET /api/budget — allocation rows, scoped to the caller. */
export const listBudgets = asyncHandler(async (req, res) => {
  const { level, financialYear, budgetHead } = req.query;
  const fy = financialYear || currentFy();
  const filter = { financialYear: fy };

  if (level) filter.level = level;
  if (budgetHead) filter.budgetHead = budgetHead;

  if (req.user.role === ROLES.DC) {
    const id = req.user.dcOffice?._id || req.user.dcOffice;
    filter.$or = [{ level: 'dc', dcOffice: id }, { level: 'school', parentDcOffice: id }];
  } else if (req.user.school) {
    filter.level = 'school';
    filter.school = req.user.school._id || req.user.school;
  }

  const budgets = await Budget.find(filter)
    .populate('school', 'name code block')
    .populate('dcOffice', 'name code')
    .populate('allocatedBy', 'name userId')
    .sort({ budgetHead: 1 });

  res.json({ success: true, financialYear: fy, count: budgets.length, budgets });
});

/** GET /api/budget/school/:id — allocated vs consumed for one school. */
export const getSchoolBudget = asyncHandler(async (req, res) => {
  const schoolId = req.params.id;

  if (req.user.school && String(req.user.school._id || req.user.school) !== String(schoolId)) {
    throw ApiError.forbidden('You can only view your own school budget.');
  }
  if (req.user.role === ROLES.DC) {
    const school = await School.findById(schoolId).select('dcOffice');
    if (!school) throw ApiError.notFound('School not found.');
    if (String(school.dcOffice) !== String(req.user.dcOffice?._id || req.user.dcOffice)) {
      throw ApiError.forbidden('This school is not mapped to your office.');
    }
  }

  const status = await schoolBudgetStatus({
    schoolId,
    financialYear: req.query.financialYear,
  });

  res.json({ success: true, school: schoolId, ...status });
});

/** GET /api/budget/dc/:id — allocated vs distributed vs consumed for one office. */
export const getDcBudget = asyncHandler(async (req, res) => {
  const dcOfficeId =
    req.params.id === 'me' ? req.user.dcOffice?._id || req.user.dcOffice : req.params.id;

  if (!dcOfficeId) throw ApiError.badRequest('No DC office resolved for this request.');
  if (
    req.user.role === ROLES.DC &&
    String(dcOfficeId) !== String(req.user.dcOffice?._id || req.user.dcOffice)
  ) {
    throw ApiError.forbidden('You can only view your own office budget.');
  }

  const status = await dcBudgetStatus({
    dcOfficeId,
    financialYear: req.query.financialYear,
  });

  res.json({ success: true, dcOffice: dcOfficeId, ...status });
});

/** DELETE /api/budget/:id — remove an allocation that was never drawn against. */
export const deleteBudget = asyncHandler(async (req, res) => {
  const budget = await Budget.findById(req.params.id);
  if (!budget) throw ApiError.notFound('Budget allocation not found.');

  if (budget.level === 'school') {
    const { rows } = await schoolBudgetStatus({
      schoolId: budget.school,
      financialYear: budget.financialYear,
      budgetHead: budget.budgetHead,
    });
    const used = rows.find((r) => r.budgetHead === budget.budgetHead)?.committed || 0;
    if (used > 0) {
      throw ApiError.badRequest(
        `${inr(used)} has already been claimed against this allocation. Revise the amount instead.`
      );
    }
  }

  await budget.deleteOne();
  await logAudit({
    req,
    action: AUDIT_ACTIONS.BUDGET_REVISED,
    detail: `Removed ${budget.budgetHead} allocation for ${budget.financialYear}`,
  });

  res.json({ success: true, message: 'Allocation removed.' });
});

/**
 * GET /api/budget/school/:id/ledger — bill-by-bill drawdown, so a school can
 * see exactly which claim reduced which allocation.
 */
export const getSchoolLedger = asyncHandler(async (req, res) => {
  const schoolId = req.params.id;

  if (req.user.school && String(req.user.school._id || req.user.school) !== String(schoolId)) {
    throw ApiError.forbidden('You can only view your own school ledger.');
  }
  if (req.user.role === ROLES.DC) {
    const school = await School.findById(schoolId).select('dcOffice');
    if (!school) throw ApiError.notFound('School not found.');
    if (String(school.dcOffice) !== String(req.user.dcOffice?._id || req.user.dcOffice)) {
      throw ApiError.forbidden('This school is not mapped to your office.');
    }
  }

  const ledger = await schoolBudgetLedger({
    schoolId,
    financialYear: req.query.financialYear,
    budgetHead: req.query.budgetHead,
  });

  res.json({ success: true, school: schoolId, ...ledger });
});
