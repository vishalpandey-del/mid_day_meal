import School from '../models/School.js';
import Block from '../models/Block.js';
import DcOffice from '../models/DcOffice.js';
import BillCategory from '../models/BillCategory.js';
import Claim from '../models/Claim.js';
import Config from '../models/Config.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import { AUDIT_ACTIONS, CLAIM_STATUS, ROLES, SCHOOL_ROLES } from '../config/constants.js';
import { safeRegex } from '../utils/scope.js';

/** Claims still moving through the chain — mirrors the dashboard definition. */
const OPEN_STATUSES = [
  CLAIM_STATUS.PENDING_CHECKER,
  CLAIM_STATUS.PENDING_BLOCK,
  CLAIM_STATUS.SUBMITTED,
  CLAIM_STATUS.UNDER_QUERY,
  CLAIM_STATUS.RESUBMITTED,
  CLAIM_STATUS.RETURNED,
];

/* ------------------------------------------------------------------ *
 * Schools
 * ------------------------------------------------------------------ */

/** GET /api/master/schools — DC users only ever see their own mapped schools. */
export const listSchools = asyncHandler(async (req, res) => {
  const { block, q, active, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (req.user.role === ROLES.DC) filter.dcOffice = req.user.dcOffice?._id;
  if (req.user.role === ROLES.BLOCK) filter.blockRef = req.user.block?._id;
  if (SCHOOL_ROLES.includes(req.user.role)) filter._id = req.user.school?._id;
  if (block && !filter.blockRef) filter.blockRef = block;
  if (req.query.district && !filter.dcOffice) filter.dcOffice = req.query.district;
  if (active !== undefined) filter.isActive = active === 'true';
  if (q) {
    const rx = safeRegex(q);
    filter.$or = [{ name: rx }, { code: rx }, { headTeacher: rx }];
  }

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [schools, total] = await Promise.all([
    School.find(filter)
      .populate('dcOffice', 'name district')
      .populate('blockRef', 'name blockId')
      .sort({ name: 1 })
      .skip(skip)
      .limit(perPage)
      .lean(),
    School.countDocuments(filter),
  ]);

  // Claim activity for just this page of schools.
  const claimCounts = await Claim.aggregate([
    { $match: { school: { $in: schools.map((s) => s._id) } } },
    { $group: {
        _id: '$school',
        n: { $sum: 1 },
        amount: { $sum: '$amount' },
        approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
    } },
  ]);
  const cMap = new Map(claimCounts.map((r) => [String(r._id), r]));

  res.json({
    success: true,
    count: schools.length,
    total,
    page: Number(page) || 1,
    pages: Math.ceil(total / perPage) || 1,
    schools: schools.map((s) => {
      const c = cMap.get(String(s._id)) || {};
      return {
        ...s,
        isPayable: Boolean(s.bank?.accountNumber && s.bank?.ifsc),
        claims: c.n || 0,
        claimAmount: c.amount || 0,
        approved: c.approved || 0,
        pending: c.pending || 0,
      };
    }),
  });
});

export const getSchool = asyncHandler(async (req, res) => {
  const school = await School.findById(req.params.id)
    .populate('dcOffice', 'name code district')
    .populate('blockRef', 'name code');
  if (!school) throw ApiError.notFound('School not found.');
  res.json({ success: true, school });
});

export const createSchool = asyncHandler(async (req, res) => {
  const school = await School.create(req.body);
  if (school.dcOffice) {
    await DcOffice.findByIdAndUpdate(school.dcOffice, { $inc: { totalSchools: 1 } });
  }
  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_CREATED,
    detail: `School created: ${school.code} · ${school.name}`,
  });
  res.status(201).json({ success: true, school });
});

export const updateSchool = asyncHandler(async (req, res) => {
  const school = await School.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!school) throw ApiError.notFound('School not found.');

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_UPDATED,
    detail: `School updated: ${school.code} · ${school.name}`,
  });
  res.json({ success: true, school });
});

/** Soft-delete: schools are never hard-removed because claims reference them. */
export const deactivateSchool = asyncHandler(async (req, res) => {
  const school = await School.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!school) throw ApiError.notFound('School not found.');

  await logAudit({ req, action: AUDIT_ACTIONS.USER_UPDATED, detail: `School deactivated: ${school.code}` });
  res.json({ success: true, school });
});

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

/** GET /api/master/blocks — blocks visible to the caller, with live counts. */
export const listBlocks = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === ROLES.DC) filter.dcOffice = req.user.dcOffice?._id;
  if (req.user.role === ROLES.BLOCK) filter._id = req.user.block?._id;
  if (SCHOOL_ROLES.includes(req.user.role)) filter._id = req.user.school?.blockRef;
  if (req.query.district) filter.dcOffice = req.query.district;
  if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';

  const blocks = await Block.find(filter)
    .populate('dcOffice', 'name district districtId')
    .sort({ name: 1 })
    .lean();
  const ids = blocks.map((b) => b._id);

  const [schoolCounts, claimCounts] = await Promise.all([
    School.aggregate([
      { $match: { blockRef: { $in: ids } } },
      { $group: {
          _id: '$blockRef',
          n: { $sum: 1 },
          payable: { $sum: { $cond: [
            { $and: [{ $ne: ['$bank.accountNumber', ''] }, { $ne: ['$bank.ifsc', ''] }] }, 1, 0] } },
      } },
    ]),
    Claim.aggregate([
      { $match: { block: { $in: ids } } },
      { $group: {
          _id: '$block',
          n: { $sum: 1 },
          amount: { $sum: '$amount' },
          approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
      } },
    ]),
  ]);

  const sMap = new Map(schoolCounts.map((r) => [String(r._id), r]));
  const cMap = new Map(claimCounts.map((r) => [String(r._id), r]));

  res.json({
    success: true,
    count: blocks.length,
    blocks: blocks.map((b) => {
      const s = sMap.get(String(b._id)) || {};
      const c = cMap.get(String(b._id)) || {};
      return {
        ...b,
        schools: s.n || 0,
        payableSchools: s.payable || 0,
        claims: c.n || 0,
        claimAmount: c.amount || 0,
        approved: c.approved || 0,
        pending: c.pending || 0,
      };
    }),
  });
});

export const createBlock = asyncHandler(async (req, res) => {
  const block = await Block.create(req.body);
  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_CREATED,
    detail: `Block created: ${block.code} · ${block.name}`,
  });
  res.status(201).json({ success: true, block });
});

export const updateBlock = asyncHandler(async (req, res) => {
  const block = await Block.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!block) throw ApiError.notFound('Block not found.');
  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_UPDATED,
    detail: `Block updated: ${block.code} · ${block.name}`,
  });
  res.json({ success: true, block });
});

/* ------------------------------------------------------------------ *
 * DC offices
 * ------------------------------------------------------------------ */

/** GET /api/master/dc-offices — districts visible to the caller, with counts. */
export const listDcOffices = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === ROLES.DC) filter._id = req.user.dcOffice?._id;
  if (req.user.role === ROLES.BLOCK) filter._id = req.user.block?.dcOffice;
  if (SCHOOL_ROLES.includes(req.user.role)) filter._id = req.user.school?.dcOffice;

  const offices = await DcOffice.find(filter).sort({ district: 1 }).lean();
  const ids = offices.map((o) => o._id);

  // Live counts, so the list never drifts from the underlying data.
  const [blockCounts, schoolCounts, claimCounts] = await Promise.all([
    Block.aggregate([{ $match: { dcOffice: { $in: ids } } }, { $group: { _id: '$dcOffice', n: { $sum: 1 } } }]),
    School.aggregate([{ $match: { dcOffice: { $in: ids } } }, { $group: { _id: '$dcOffice', n: { $sum: 1 } } }]),
    Claim.aggregate([
      { $match: { dcOffice: { $in: ids } } },
      { $group: {
          _id: '$dcOffice',
          n: { $sum: 1 },
          amount: { $sum: '$amount' },
          approved: { $sum: { $cond: [{ $eq: ['$status', CLAIM_STATUS.APPROVED] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
      } },
    ]),
  ]);

  const byId = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const bMap = byId(blockCounts), sMap = byId(schoolCounts), cMap = byId(claimCounts);

  res.json({
    success: true,
    count: offices.length,
    offices: offices.map((o) => {
      const c = cMap.get(String(o._id)) || {};
      return {
        ...o,
        blocks: bMap.get(String(o._id))?.n || 0,
        schools: sMap.get(String(o._id))?.n || 0,
        claims: c.n || 0,
        claimAmount: c.amount || 0,
        approved: c.approved || 0,
        pending: c.pending || 0,
      };
    }),
  });
});

export const createDcOffice = asyncHandler(async (req, res) => {
  const office = await DcOffice.create(req.body);
  await logAudit({ req, action: AUDIT_ACTIONS.USER_CREATED, detail: `DC office created: ${office.code}` });
  res.status(201).json({ success: true, office });
});

export const updateDcOffice = asyncHandler(async (req, res) => {
  const office = await DcOffice.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!office) throw ApiError.notFound('DC office not found.');
  await logAudit({ req, action: AUDIT_ACTIONS.USER_UPDATED, detail: `DC office updated: ${office.code}` });
  res.json({ success: true, office });
});

/* ------------------------------------------------------------------ *
 * Bill categories
 * ------------------------------------------------------------------ */

export const listCategories = asyncHandler(async (req, res) => {
  const filter = req.query.all === 'true' ? {} : { isActive: true };
  const categories = await BillCategory.find(filter).sort({ name: 1 });
  res.json({ success: true, categories });
});

export const createCategory = asyncHandler(async (req, res) => {
  const category = await BillCategory.create(req.body);
  await logAudit({ req, action: AUDIT_ACTIONS.CONFIG_UPDATED, detail: `Category created: ${category.name}` });
  res.status(201).json({ success: true, category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await BillCategory.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!category) throw ApiError.notFound('Category not found.');
  await logAudit({ req, action: AUDIT_ACTIONS.CONFIG_UPDATED, detail: `Category updated: ${category.name}` });
  res.json({ success: true, category });
});

/* ------------------------------------------------------------------ *
 * Global config (SLA + notification matrix)
 * ------------------------------------------------------------------ */

export const getConfig = asyncHandler(async (_req, res) => {
  const config = await Config.getGlobal();
  res.json({ success: true, config });
});

export const updateConfig = asyncHandler(async (req, res) => {
  // getGlobal returns a lean object, so fetch a real document to save.
  const config = (await Config.findOne({ key: 'global' })) || (await Config.create({ key: 'global' }));
  if (req.body.sla) Object.assign(config.sla, req.body.sla);
  if (req.body.notifications) config.notifications = req.body.notifications;
  await config.save();
  Config.clearCache();

  await logAudit({
    req,
    action: AUDIT_ACTIONS.CONFIG_UPDATED,
    detail: `SLA ${config.sla.reminderDay}d reminder / ${config.sla.breachDay}d breach`,
  });

  res.json({ success: true, config });
});
