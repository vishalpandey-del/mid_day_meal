import Claim from '../models/Claim.js';
import School from '../models/School.js';
import BillCategory from '../models/BillCategory.js';
import Config from '../models/Config.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { claimScope, assertCanView, safeRegex, toObjectId } from '../utils/scope.js';
import { generateClaimId } from '../services/claimIdService.js';
import { logAudit } from '../services/auditService.js';
import { checkBudgetFor, assertWithinBudget } from '../services/budgetService.js';
import {
  notify,
  recipientsForSchool,
  recipientsForRole,
  recipientsForBlock,
  recipientsForDc,
} from '../services/notificationService.js';
import {
  AUDIT_ACTIONS,
  CLAIM_STATUS,
  DC_ACTIONABLE,
  PAYMENT_STATUS,
  ROLES,
} from '../config/constants.js';
import { inr } from '../utils/format.js';
import { persistFiles, readFile, removeFiles } from '../middleware/upload.js';


/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/** GET /api/claims — paginated, filterable list within the caller's scope. */
export const listClaims = asyncHandler(async (req, res) => {
  const {
    status, category, budgetHead, school, block, paymentStatus, q,
    from, to, minAmount, maxAmount,
    page = 1, limit = 20, sort = '-createdAt',
  } = req.query;

  const filter = { ...claimScope(req.user) };

  if (status) filter.status = { $in: String(status).split(',') };
  if (category) filter.category = category;
  if (budgetHead) filter.budgetHead = budgetHead;
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  // A narrower scope always wins over a query parameter.
  if (school && !filter.school) filter.school = toObjectId(school);
  if (block && !filter.block && !filter.school) filter.block = toObjectId(block);

  if (from || to) {
    filter.billDate = {};
    if (from) filter.billDate.$gte = new Date(from);
    if (to) filter.billDate.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (minAmount || maxAmount) {
    filter.amount = {};
    if (minAmount) filter.amount.$gte = Number(minAmount);
    if (maxAmount) filter.amount.$lte = Number(maxAmount);
  }
  if (q) {
    const rx = safeRegex(q);
    // The school's name lives on another collection, so it is resolved to ids
    // first — that way one box finds a claim by its number, its vendor or the
    // school that raised it.
    const schools = await School.find({ $or: [{ name: rx }, { code: rx }] })
      .select('_id')
      .limit(200)
      .lean();
    filter.$or = [
      { claimId: rx },
      { vendorName: rx },
      { billNumber: rx },
      ...(schools.length ? [{ school: { $in: schools.map((x) => x._id) } }] : []),
    ];
  }

  const perPage = Math.min(Number(limit) || 20, 100);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [items, total] = await Promise.all([
    Claim.find(filter)
      .populate('school', 'name code block district bank gstin')
      .populate('block', 'name code')
      .populate('dcOffice', 'name code district')
      .populate('submittedBy', 'name userId')
      .sort(sort)
      .skip(skip)
      .limit(perPage),
    Claim.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: items.length,
    total,
    page: Number(page) || 1,
    pages: Math.ceil(total / perPage) || 1,
    claims: items,
  });
});

/** GET /api/claims/:id — accepts a Mongo _id or a human claimId. */
export const getClaim = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const byClaimId = /^CLM-/i.test(id);

  const claim = await Claim.findOne(byClaimId ? { claimId: id.toUpperCase() } : { _id: id })
    .populate('school')
    .populate('block', 'name code')
    .populate('dcOffice')
    .populate('submittedBy', 'name userId designation')
    .populate('checkedBy', 'name userId')
    .populate('blockReviewedBy', 'name userId')
    .populate('history.byUser', 'name userId role');

  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  res.json({ success: true, claim });
});

/* ------------------------------------------------------------------ *
 * Create / update (maker)
 * ------------------------------------------------------------------ */

/**
 * POST /api/claims — the school maker creates a claim.
 * `saveAsDraft=true` keeps it editable; otherwise it goes to the checker.
 */
export const createClaim = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user.school) throw ApiError.forbidden('Your account is not linked to a school.');

  const school = await School.findById(user.school._id || user.school);
  if (!school) throw ApiError.notFound('Linked school record is missing.');
  if (!school.dcOffice) {
    throw ApiError.badRequest('Your school has no DC office mapped. Contact the administrator.');
  }
  if (!school.blockRef) {
    throw ApiError.badRequest('Your school has no block mapped. Contact the administrator.');
  }

  const { category, saveAsDraft, ...rest } = req.body;

  const cat = await BillCategory.findOne({ name: category, isActive: true });
  if (!cat) throw ApiError.badRequest(`Unknown bill category: ${category}`);
  if (cat.maxAmount && rest.amount > cat.maxAmount) {
    throw ApiError.badRequest(
      `${category} claims are capped at ${inr(cat.maxAmount)}. Submitted: ${inr(rest.amount)}.`
    );
  }

  const isDraft = saveAsDraft === true || saveAsDraft === 'true';

  /*
   * The budget is checked before anything is written. A school cannot raise a
   * bill it has no allocation for, and cannot raise one that would take it
   * past what is left — including bills still working their way up the chain,
   * which are already holding their share. A draft is checked too: sending it
   * later would only move the refusal to a worse moment.
   */
  const budget = await assertWithinBudget({
    schoolId: school._id,
    budgetHead: cat.budgetHead,
    amount: rest.amount,
    billDate: rest.billDate,
  });

  const claim = new Claim({
    ...rest,
    category,
    budgetHead: cat.budgetHead,
    claimId: await generateClaimId(),
    school: school._id,
    block: school.blockRef,
    dcOffice: school.dcOffice,
    submittedBy: user._id,
    attachments: await persistFiles(req.files, { user }),
    status: isDraft ? CLAIM_STATUS.DRAFT : CLAIM_STATUS.PENDING_CHECKER,
    submittedAt: null,
  });

  claim.pushHistory(
    isDraft ? AUDIT_ACTIONS.CLAIM_DRAFTED : AUDIT_ACTIONS.CLAIM_SUBMITTED,
    user,
    isDraft ? 'Saved as draft' : `Sent for checker review · ${inr(claim.amount)}`
  );
  await claim.save();

  await logAudit({
    req,
    action: isDraft ? AUDIT_ACTIONS.CLAIM_DRAFTED : AUDIT_ACTIONS.CLAIM_SUBMITTED,
    claimId: claim.claimId,
    detail: `${category} · ${inr(claim.amount)} · ${claim.vendorName}`,
  });

  if (!isDraft) {
    await notify({
      recipients: await recipientsForRole(ROLES.SCHOOL_CHECKER, { school: school._id }),
      icon: '📝',
      title: `Claim ${claim.claimId} awaiting your review`,
      body: `${user.name} submitted a ${category} claim for ${inr(claim.amount)}.`,
      claim,
    });
  }

  res.status(201).json({ success: true, claim, budget });
});

/** PUT /api/claims/:id — edit a Draft or a Returned claim. Maker only. */
export const updateClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  const editable = [CLAIM_STATUS.DRAFT, CLAIM_STATUS.RETURNED];
  if (!editable.includes(claim.status)) {
    throw ApiError.badRequest(
      `Only drafts and returned claims can be edited. This claim is "${claim.status}".`
    );
  }

  const { category, sendForReview, saveAsDraft, ...rest } = req.body;
  if (category && category !== claim.category) {
    const cat = await BillCategory.findOne({ name: category, isActive: true });
    if (!cat) throw ApiError.badRequest(`Unknown bill category: ${category}`);
    claim.category = category;
    claim.budgetHead = cat.budgetHead;
  }
  Object.assign(claim, rest);

  /*
   * Re-check after the edit: raising the amount, or moving the bill to a
   * scheme with less left in it, must be refused the same as raising it that
   * way in the first place. The claim excludes itself, since its old amount
   * is already counted as committed.
   */
  await assertWithinBudget({
    schoolId: claim.school,
    budgetHead: claim.budgetHead,
    amount: claim.amount,
    billDate: claim.billDate,
    excludeClaimId: claim._id,
  });

  if (req.files?.length) {
    claim.attachments.push(
      ...(await persistFiles(req.files, { user: req.user, claimId: claim._id }))
    );
  }

  // What goes to PFMS has changed, so the bill is owed a place in the next
  // file even if an older version of it was already downloaded.
  claim.exportDue = true;

  claim.pushHistory('Claim Updated', req.user);

  /*
   * A returned bill is corrected and sent back in one step. Doing both here
   * means one save: the edit cannot be kept while the claim silently stays
   * in the maker's hands, which is how a corrected bill goes unnoticed.
   */
  const alsoSend = sendForReview === true || sendForReview === 'true';
  const { resubmit } = alsoSend ? await sendToChecker(claim, req) : {};

  await claim.save();
  if (alsoSend) {
    await claim.populate('school', 'name');
    await announceToChecker(claim, req, resubmit);
  }

  res.json({ success: true, claim });
});

/**
 * Moves a Draft or Returned claim into the checker's queue.
 *
 * Shared by the submit endpoint and by an edit that asks to send the bill on
 * in the same step, so the history entry, the audit line and the checker's
 * notification read the same either way. The caller saves; this does not.
 */
const sendToChecker = async (claim, req) => {
  const submittable = [CLAIM_STATUS.DRAFT, CLAIM_STATUS.RETURNED];
  if (!submittable.includes(claim.status)) {
    throw ApiError.badRequest(`This claim is "${claim.status}" and cannot be submitted.`);
  }
  if (!claim.attachments.length) {
    throw ApiError.badRequest('Attach at least one bill document before submitting.');
  }

  const resubmit = claim.status === CLAIM_STATUS.RETURNED;
  claim.status = CLAIM_STATUS.PENDING_CHECKER;
  claim.returnReason = '';
  claim.pushHistory(
    resubmit ? AUDIT_ACTIONS.CLAIM_RESUBMITTED : AUDIT_ACTIONS.CLAIM_SUBMITTED,
    req.user,
    `Sent for checker review · ${inr(claim.amount)}`
  );
  return { resubmit };
};

/** The audit line and the checker's alert, once the claim is safely saved. */
const announceToChecker = async (claim, req, resubmit) => {
  await logAudit({
    req,
    action: resubmit ? AUDIT_ACTIONS.CLAIM_RESUBMITTED : AUDIT_ACTIONS.CLAIM_SUBMITTED,
    claimId: claim.claimId,
    detail: `${claim.category} · ${inr(claim.amount)}`,
  });

  await notify({
    recipients: await recipientsForRole(ROLES.SCHOOL_CHECKER, {
      school: claim.school?._id || claim.school,
    }),
    icon: '📝',
    title: `Claim ${claim.claimId} awaiting your review`,
    body: `${claim.school?.name} sent a claim for ${inr(claim.amount)}.`,
    claim,
  });
};

/** POST /api/claims/:id/submit — maker sends a Draft/Returned claim to the checker. */
export const submitClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  const { resubmit } = await sendToChecker(claim, req);
  await claim.save();
  await announceToChecker(claim, req, resubmit);

  res.json({ success: true, claim });
});

/** DELETE /api/claims/:id — drafts only; removes orphaned uploads too. */
export const deleteClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (claim.status !== CLAIM_STATUS.DRAFT) {
    throw ApiError.badRequest('Only drafts can be deleted. Submitted claims are permanent records.');
  }

  await removeFiles(claim.attachments.map((a) => a.storedName));
  await claim.deleteOne();

  res.json({ success: true, message: `Draft ${claim.claimId} deleted.` });
});

/* ------------------------------------------------------------------ *
 * Review chain — checker and block may only record a remark.
 * ------------------------------------------------------------------ */

/**
 * POST /api/claims/:id/forward — move the claim one stage up the chain.
 * Checker → Block → DC. Reviewers cannot edit any claim field.
 */
export const forwardClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  const remarks = req.body.remarks || '';
  const now = new Date();
  let notifyTargets;
  let title;

  if (req.user.role !== ROLES.SCHOOL_CHECKER) {
    throw ApiError.forbidden('Only a school checker can forward a claim.');
  }
  if (claim.status !== CLAIM_STATUS.PENDING_CHECKER) {
    throw ApiError.badRequest(`This claim is "${claim.status}" and is not awaiting checker review.`);
  }

  // The checker hands the claim straight to the DC; the block only watches.
  claim.status = CLAIM_STATUS.SUBMITTED;
  claim.checkerRemarks = remarks;
  claim.checkedBy = req.user._id;
  claim.checkedAt = now;
  // The SLA clock starts when the claim reaches the DC.
  claim.submittedAt = now;
  notifyTargets = await recipientsForDc(claim.dcOffice);
  title = `Claim ${claim.claimId} forwarded to your office`;

  claim.pushHistory(AUDIT_ACTIONS.CLAIM_FORWARDED, req.user, remarks);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CLAIM_FORWARDED,
    claimId: claim.claimId,
    detail: `${req.user.role} forwarded · ${remarks || 'no remark'}`,
  });

  await notify({
    recipients: notifyTargets,
    icon: '➡️',
    title,
    body: `${claim.school?.name} · ${inr(claim.amount)}. ${remarks}`.trim(),
    claim,
  });

  res.json({ success: true, claim });
});

/**
 * POST /api/claims/:id/return — send the claim back to the maker with a remark.
 * Available to the checker and the block; a reason is mandatory.
 */
export const returnClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (req.user.role !== ROLES.SCHOOL_CHECKER) {
    throw ApiError.forbidden('Only a school checker can return a claim.');
  }
  if (claim.status !== CLAIM_STATUS.PENDING_CHECKER) {
    throw ApiError.badRequest(`This claim is "${claim.status}" and is not awaiting your review.`);
  }

  const remarks = req.body.remarks;
  claim.status = CLAIM_STATUS.RETURNED;
  claim.returnReason = remarks;
  claim.checkerRemarks = remarks;
  claim.checkedBy = req.user._id;
  claim.checkedAt = new Date();

  claim.pushHistory(AUDIT_ACTIONS.CLAIM_RETURNED, req.user, remarks);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CLAIM_RETURNED,
    claimId: claim.claimId,
    detail: remarks,
  });

  await notify({
    recipients: await recipientsForRole(ROLES.SCHOOL_MAKER, {
      school: claim.school?._id || claim.school,
    }),
    icon: '↩️',
    title: `Claim ${claim.claimId} returned for correction`,
    body: remarks,
    claim,
  });

  res.json({ success: true, claim });
});

/* ------------------------------------------------------------------ *
 * DC decisions
 * ------------------------------------------------------------------ */

const assertDcActionable = (claim, user) => {
  assertCanView(claim, user);
  if (!DC_ACTIONABLE.includes(claim.status)) {
    throw ApiError.badRequest(`A claim in "${claim.status}" state cannot be actioned.`);
  }
};

/**
 * An approved claim that has already been downloaded into a beneficiary file
 * cannot change status silently — the person making the change must say why.
 */
const requirePostExportRemark = (claim, remarks) => {
  if (!claim.lastExportedAt) return;
  if (!remarks || String(remarks).trim().length < 5) {
    throw ApiError.badRequest(
      `Claim ${claim.claimId} was already downloaded in a beneficiary file on ` +
        `${new Date(claim.lastExportedAt).toLocaleDateString('en-IN')}. ` +
        'Record a remark (at least 5 characters) explaining this status change.'
    );
  }
};

/** POST /api/claims/:id/approve */
export const approveClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertDcActionable(claim, req.user);

  const now = new Date();
  claim.status = CLAIM_STATUS.APPROVED;
  claim.dcRemarks = req.body.remarks || '';
  claim.approvedAt = now;
  claim.decidedAt = now;
  /*
   * Approval is the moment a bill becomes payable, so it is owed a place in
   * the next beneficiary file — including a bill approved a second time after
   * a correction, whose earlier version was already downloaded.
   */
  claim.exportDue = true;
  claim.pushHistory(AUDIT_ACTIONS.CLAIM_APPROVED, req.user, req.body.remarks || '');
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CLAIM_APPROVED,
    claimId: claim.claimId,
    detail: `${inr(claim.amount)} · ${claim.school?.name || ''}`,
  });

  await notify({
    recipients: await recipientsForSchool(claim.school?._id || claim.school),
    icon: '✅',
    title: `Claim ${claim.claimId} approved`,
    body: `Your claim for ${inr(claim.amount)} has been approved and queued for payment.`,
    claim,
  });

  res.json({ success: true, claim });
});

/**
 * POST /api/claims/bulk-approve — approve many claims in one action.
 * Each claim is checked individually; failures are reported, not thrown.
 */
export const bulkApproveClaims = asyncHandler(async (req, res) => {
  const { claimIds, remarks = '' } = req.body;

  const claims = await Claim.find({ _id: { $in: claimIds } }).populate('school', 'name');

  const approved = [];
  const failed = [];
  const notifyBySchool = new Map();

  for (const claim of claims) {
    try {
      assertDcActionable(claim, req.user);
      requirePostExportRemark(claim, remarks);

      const now = new Date();
      claim.status = CLAIM_STATUS.APPROVED;
      claim.dcRemarks = remarks;
      claim.approvedAt = now;
      claim.decidedAt = now;
      claim.exportDue = true;
      if (claim.lastExportedAt) claim.postExportRemarks = remarks;
      claim.pushHistory(AUDIT_ACTIONS.CLAIM_APPROVED, req.user, remarks || 'Bulk approval');
      await claim.save();

      approved.push({ id: claim._id, claimId: claim.claimId, amount: claim.amount });

      const key = String(claim.school?._id || claim.school);
      notifyBySchool.set(key, (notifyBySchool.get(key) || 0) + 1);
    } catch (err) {
      failed.push({
        id: claim._id,
        claimId: claim.claimId,
        reason: err.message,
      });
    }
  }

  // Claims the caller asked for that do not exist at all.
  const found = new Set(claims.map((c) => String(c._id)));
  for (const id of claimIds) {
    if (!found.has(String(id))) failed.push({ id, claimId: null, reason: 'Claim not found.' });
  }

  const totalAmount = approved.reduce((s, c) => s + c.amount, 0);

  if (approved.length) {
    await logAudit({
      req,
      action: AUDIT_ACTIONS.CLAIM_BULK_APPROVED,
      detail: `${approved.length} claim(s) · ${inr(totalAmount)} · ${approved
        .map((a) => a.claimId)
        .join(', ')}`,
    });

    // One notification per school rather than one per claim.
    for (const [schoolId, count] of notifyBySchool) {
      await notify({
        recipients: await recipientsForSchool(schoolId),
        icon: '✅',
        title: `${count} claim(s) approved`,
        body: `The DC office approved ${count} of your claims. ${remarks}`.trim(),
      });
    }
  }

  res.json({
    success: true,
    approvedCount: approved.length,
    failedCount: failed.length,
    totalAmount,
    approved,
    failed,
  });
});

/** POST /api/claims/:id/reject — rejection is final and requires a reason. */
export const rejectClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertDcActionable(claim, req.user);

  const now = new Date();
  claim.status = CLAIM_STATUS.REJECTED;
  claim.dcRemarks = req.body.remarks;
  claim.decidedAt = now;
  claim.pushHistory(AUDIT_ACTIONS.CLAIM_REJECTED, req.user, req.body.remarks);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CLAIM_REJECTED,
    claimId: claim.claimId,
    detail: req.body.remarks,
  });

  await notify({
    recipients: await recipientsForSchool(claim.school?._id || claim.school),
    icon: '❌',
    title: `Claim ${claim.claimId} rejected`,
    body: req.body.remarks,
    claim,
  });

  res.json({ success: true, claim });
});

/**
 * POST /api/claims/:id/reopen — the DC undoes a rejection.
 *
 * A rejection is final for the school: it cannot edit the bill, cannot send
 * it again, and the money is released back to the allocation. That is right
 * when the bill was genuinely wrong, but it leaves nothing to do when the
 * rejection was a mistake, or when the school has since produced what was
 * missing. Only the DC rejects, so only the DC undoes it — and it goes back
 * to the school rather than straight to Approved, so the correction is made
 * and reviewed rather than assumed.
 */
export const reopenClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (claim.status !== CLAIM_STATUS.REJECTED) {
    throw ApiError.badRequest(
      `Only a rejected bill can be reopened. This one is "${claim.status}".`
    );
  }

  const remarks = req.body.remarks;
  const now = new Date();

  claim.status = CLAIM_STATUS.RETURNED;
  claim.returnReason = remarks;
  claim.dcRemarks = remarks;
  // The earlier decision no longer stands; the SLA clock restarts when the
  // bill next reaches the DC.
  claim.decidedAt = null;
  claim.approvedAt = null;
  claim.submittedAt = null;
  claim.paymentStatus = PAYMENT_STATUS.UNPAID;

  claim.pushHistory(AUDIT_ACTIONS.CLAIM_REOPENED, req.user, remarks);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CLAIM_REOPENED,
    claimId: claim.claimId,
    detail: `Rejection withdrawn · ${remarks}`,
  });

  await notify({
    recipients: await recipientsForRole(ROLES.SCHOOL_MAKER, {
      school: claim.school?._id || claim.school,
    }),
    icon: '↩️',
    title: `Claim ${claim.claimId} reopened`,
    body: `The district has withdrawn the rejection. ${remarks}`,
    claim,
  });

  res.json({ success: true, claim });
});

/** POST /api/claims/:id/query — raise a query; this pauses the SLA clock. */
export const queryClaim = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertDcActionable(claim, req.user);

  if (claim.status === CLAIM_STATUS.UNDER_QUERY) {
    throw ApiError.badRequest('This claim already has an open query.');
  }

  claim.status = CLAIM_STATUS.UNDER_QUERY;
  claim.queryText = req.body.queryText;
  claim.queryRaisedAt = new Date();
  claim.queryResponse = '';
  claim.queryRespondedAt = null;
  claim.pushHistory(AUDIT_ACTIONS.CLAIM_QUERIED, req.user, req.body.queryText);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CLAIM_QUERIED,
    claimId: claim.claimId,
    detail: req.body.queryText,
  });

  await notify({
    recipients: await recipientsForSchool(claim.school?._id || claim.school),
    icon: '❓',
    title: `Query raised on ${claim.claimId}`,
    body: req.body.queryText,
    claim,
  });

  res.json({ success: true, claim });
});

/**
 * POST /api/claims/:id/respond — the maker answers a DC query.
 * Banks the paused days so the SLA clock resumes where it left off.
 */
export const respondToQuery = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (claim.status !== CLAIM_STATUS.UNDER_QUERY) {
    throw ApiError.badRequest('There is no open query on this claim.');
  }

  const cfg = await Config.getGlobal();
  if (cfg.sla.pauseOnQuery && claim.queryRaisedAt) {
    claim.pausedDays += Math.floor((Date.now() - new Date(claim.queryRaisedAt)) / 86400000);
  }

  claim.queryResponse = req.body.response;
  claim.queryRespondedAt = new Date();
  claim.status = CLAIM_STATUS.RESUBMITTED;

  if (req.files?.length) {
    claim.attachments.push(
      ...(await persistFiles(req.files, {
        kind: 'query_response',
        user: req.user,
        claimId: claim._id,
      }))
    );
  }

  claim.pushHistory(AUDIT_ACTIONS.QUERY_RESPONDED, req.user, req.body.response);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.QUERY_RESPONDED,
    claimId: claim.claimId,
    detail: req.body.response,
  });

  await notify({
    recipients: await recipientsForDc(claim.dcOffice),
    icon: '📤',
    title: `Query answered on ${claim.claimId}`,
    body: `${claim.school?.name} responded. The claim is back in your queue.`,
    claim,
  });

  res.json({ success: true, claim });
});

/* ------------------------------------------------------------------ *
 * Payment status — DC only
 * ------------------------------------------------------------------ */

/**
 * PATCH /api/claims/:id/payment — mark an approved claim Paid or Unpaid.
 * Only the DC office may do this, and only after approval.
 */
export const setPaymentStatus = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (claim.status !== CLAIM_STATUS.APPROVED) {
    throw ApiError.badRequest(
      `Payment status applies only to approved claims. This claim is "${claim.status}".`
    );
  }

  const { paymentStatus, paymentRef = '', remarks = '' } = req.body;
  const from = claim.paymentStatus;

  if (from === paymentStatus) {
    throw ApiError.badRequest(`This bill is already marked "${paymentStatus}".`);
  }

  // Money can only bounce back from a payment that actually went out.
  if (paymentStatus === PAYMENT_STATUS.REVERSED) {
    if (from !== PAYMENT_STATUS.PAID) {
      throw ApiError.badRequest(
        'Only a Paid bill can be reversed. This bill was never paid out.'
      );
    }
    if (!remarks || remarks.trim().length < 5) {
      throw ApiError.badRequest(
        'Record why the payment came back (at least 5 characters), e.g. account closed or wrong IFSC.'
      );
    }
  }

  claim.paymentStatus = paymentStatus;

  if (paymentStatus === PAYMENT_STATUS.PAID) {
    claim.paidAt = new Date();
    claim.paymentRef = paymentRef;
    // Paying again clears the reversal flag but keeps the count, so the
    // history of failed attempts survives.
    claim.reversedAt = null;
    claim.reversalReason = '';
    // Settled: it has no further business in a beneficiary file.
    claim.exportDue = false;
  } else if (paymentStatus === PAYMENT_STATUS.REVERSED) {
    claim.reversedAt = new Date();
    claim.reversalReason = remarks;
    claim.reversalCount += 1;
    claim.paidAt = null;
    // The money came back, so the bill must go out again — a fresh one as far
    // as the next file is concerned.
    claim.exportDue = true;
  } else {
    // Back to Unpaid — the bill was never really settled, so it is owed again.
    claim.paidAt = null;
    claim.paymentRef = '';
    claim.reversedAt = null;
    claim.reversalReason = '';
    claim.exportDue = true;
  }

  claim.paymentRemarks = remarks;

  const note =
    `${from} → ${paymentStatus}` +
    (paymentRef ? ` · ref ${paymentRef}` : '') +
    (remarks ? ` · ${remarks}` : '');
  claim.pushHistory(
    paymentStatus === PAYMENT_STATUS.REVERSED
      ? AUDIT_ACTIONS.PAYMENT_REVERSED
      : AUDIT_ACTIONS.PAYMENT_MARKED,
    req.user,
    note
  );
  await claim.save();

  await logAudit({
    req,
    action:
      paymentStatus === PAYMENT_STATUS.REVERSED
        ? AUDIT_ACTIONS.PAYMENT_REVERSED
        : AUDIT_ACTIONS.PAYMENT_MARKED,
    claimId: claim.claimId,
    detail: `${inr(claim.amount)} · ${note}`,
  });

  if (paymentStatus === PAYMENT_STATUS.PAID) {
    await notify({
      recipients: await recipientsForSchool(claim.school?._id || claim.school),
      icon: '💰',
      title: `Payment released for ${claim.claimId}`,
      body: `${inr(claim.amount)} has been marked paid.${paymentRef ? ` Ref: ${paymentRef}.` : ''}`,
      claim,
    });
  } else if (paymentStatus === PAYMENT_STATUS.REVERSED) {
    await notify({
      recipients: await recipientsForSchool(claim.school?._id || claim.school),
      icon: '⚠️',
      title: `Payment reversed for ${claim.claimId}`,
      body: `${inr(claim.amount)} came back and will be paid again. Reason: ${remarks}`,
      claim,
    });
  }

  res.json({ success: true, claim });
});

/**
 * PATCH /api/claims/:id/revise-status — change the status of a claim that has
 * already been downloaded in a beneficiary file. A remark is mandatory, and
 * the change is recorded distinctly in the audit trail.
 */
export const reviseExportedStatus = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id).populate('school', 'name');
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (!claim.lastExportedAt) {
    throw ApiError.badRequest(
      'This claim has not been exported yet. Use the normal approve/reject actions.'
    );
  }

  const { status, remarks } = req.body;
  requirePostExportRemark(claim, remarks);

  const previous = claim.status;
  if (previous === status) {
    throw ApiError.badRequest(`Claim ${claim.claimId} is already "${status}".`);
  }

  claim.status = status;
  claim.postExportRemarks = remarks;
  // The decision on this bill has changed since it was last downloaded, so
  // the next file should carry the current one.
  claim.exportDue = status === CLAIM_STATUS.APPROVED;
  if (status === CLAIM_STATUS.REJECTED) {
    claim.dcRemarks = remarks;
    claim.decidedAt = new Date();
    claim.approvedAt = null;
    // A rejected claim must not stay marked payable.
    claim.paymentStatus = PAYMENT_STATUS.UNPAID;
    claim.paidAt = null;
  }

  claim.pushHistory(
    AUDIT_ACTIONS.POST_EXPORT_CHANGE,
    req.user,
    `${previous} → ${status} after export · ${remarks}`
  );
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.POST_EXPORT_CHANGE,
    claimId: claim.claimId,
    detail: `${previous} → ${status} · exported ${new Date(
      claim.lastExportedAt
    ).toISOString().slice(0, 10)} · ${remarks}`,
  });

  await notify({
    recipients: await recipientsForSchool(claim.school?._id || claim.school),
    icon: '⚠️',
    title: `Claim ${claim.claimId} status revised to ${status}`,
    body: remarks,
    claim,
  });

  res.json({ success: true, claim, previousStatus: previous });
});

/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ */

/** POST /api/claims/:id/attachments */
export const addAttachments = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  if (!req.files?.length) throw ApiError.badRequest('No files received.');
  if ([CLAIM_STATUS.APPROVED, CLAIM_STATUS.REJECTED, CLAIM_STATUS.CLOSED].includes(claim.status)) {
    throw ApiError.badRequest(`Documents cannot be added to a "${claim.status}" claim.`);
  }

  claim.attachments.push(
    ...(await persistFiles(req.files, {
      kind: req.body.kind || 'supporting',
      user: req.user,
      claimId: claim._id,
    }))
  );
  claim.pushHistory(AUDIT_ACTIONS.FILE_UPLOADED, req.user, `${req.files.length} file(s)`);
  await claim.save();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.FILE_UPLOADED,
    claimId: claim.claimId,
    detail: req.files.map((f) => f.originalname).join(', '),
  });

  res.status(201).json({ success: true, attachments: claim.attachments });
});

/** GET /api/claims/:id/attachments/:storedName — streams a file after a scope check. */
export const downloadAttachment = asyncHandler(async (req, res) => {
  const claim = await Claim.findById(req.params.id);
  if (!claim) throw ApiError.notFound('Claim not found.');
  assertCanView(claim, req.user);

  // Resolve through the claim record only — never trust the path param.
  const att = claim.attachments.find((a) => a.storedName === req.params.storedName);
  if (!att) throw ApiError.notFound('Attachment not found on this claim.');

  const file = await readFile(att.storedName);
  if (!file) throw ApiError.notFound('File is missing from storage.');

  res.setHeader('Content-Type', file.mimeType || att.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${att.originalName}"`);
  res.setHeader('Content-Length', file.buffer.length);
  res.send(file.buffer);
});
