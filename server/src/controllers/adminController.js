import School from '../models/School.js';
import Block from '../models/Block.js';
import DcOffice from '../models/DcOffice.js';
import User from '../models/User.js';
import Claim from '../models/Claim.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import { parseWorkbook, buildWorkbook, sendWorkbook } from '../services/excelService.js';
import {
  resolveHeaders,
  analyseRows,
  commitImport,
  COLUMN_MAP,
  REQUIRED,
} from '../services/masterImportService.js';
import { planProvisioning, commitProvisioning } from '../services/provisionService.js';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import { todayStamp } from '../utils/format.js';

/* ------------------------------------------------------------------ *
 * Master data upload
 * ------------------------------------------------------------------ */

/** Shared first half of both preview and commit. */
const readSheet = async (req) => {
  if (!req.file) throw ApiError.badRequest('Upload the master .xlsx file in the "file" field.');

  const { headers, rows } = await parseWorkbook(req.file.buffer);
  if (!rows.length) throw ApiError.badRequest('The sheet has no data rows below the header.');

  const { resolved, missing, unknown } = resolveHeaders(headers);
  if (missing.length) {
    throw ApiError.badRequest(
      `The sheet is missing required column(s): ${missing.join(', ')}.`,
      missing.map((f) => ({ field: f, message: `Expected one of: ${COLUMN_MAP[f].join(', ')}` }))
    );
  }

  return { headers, rows, resolved, unknown, analysis: analyseRows(rows, resolved) };
};

/**
 * POST /api/admin/master/preview — parse and report, writing nothing.
 * The admin sees exactly what would be created before committing.
 */
export const previewMaster = asyncHandler(async (req, res) => {
  const { rows, resolved, unknown, analysis } = await readSheet(req);

  // Flag which of these already exist, so the admin sees new vs update.
  const codes = analysis.records.map((r) => r.code);
  const existingCodes = new Set(
    (await School.find({ code: { $in: codes } }).select('code').lean()).map((s) => s.code)
  );
  const existingDistricts = new Set(
    (await DcOffice.find({ districtId: { $in: analysis.districts.map((d) => d.districtId) } })
      .select('districtId').lean()).map((d) => d.districtId)
  );
  const existingBlocks = new Set(
    (await Block.find({ blockId: { $in: analysis.blocks.map((b) => b.blockId) } })
      .select('blockId').lean()).map((b) => b.blockId)
  );

  res.json({
    success: true,
    file: req.file.originalname,
    rowsInSheet: rows.length,
    columnsMatched: Object.keys(resolved).length,
    unmatchedColumns: unknown,
    districts: analysis.districts.map((d) => ({
      ...d, status: existingDistricts.has(d.districtId) ? 'update' : 'new',
    })),
    blocks: analysis.blocks.map((b) => ({
      ...b, status: existingBlocks.has(b.blockId) ? 'update' : 'new',
    })),
    schools: {
      total: analysis.records.length,
      new: analysis.records.filter((r) => !existingCodes.has(r.code)).length,
      update: analysis.records.filter((r) => existingCodes.has(r.code)).length,
    },
    sample: analysis.records.slice(0, 5).map((r) => ({
      code: r.code, name: r.name, district: r.district, block: r.block, cluster: r.cluster,
    })),
    skipped: analysis.skipped,
    warnings: analysis.warnings,
  });
});

/**
 * POST /api/admin/master/import — commit the sheet.
 * Creates districts and blocks from the ids in the file, then the schools.
 */
export const importMaster = asyncHandler(async (req, res) => {
  const { analysis } = await readSheet(req);

  if (!analysis.records.length) {
    throw ApiError.badRequest('No valid rows to import. Check the preview for the reasons.');
  }

  const result = await commitImport(analysis);

  await logAudit({
    req,
    action: AUDIT_ACTIONS.IMPORT,
    detail:
      `Master upload — districts +${result.districts.created}/~${result.districts.updated}, ` +
      `blocks +${result.blocks.created}/~${result.blocks.updated}, ` +
      `schools +${result.schools.inserted}/~${result.schools.updated}, ` +
      `skipped ${analysis.skipped.length}`,
  });

  res.status(201).json({
    success: true,
    ...result,
    skipped: analysis.skipped,
    warnings: analysis.warnings,
    nextStep: 'Call POST /api/admin/provision/preview to see the logins this data needs.',
  });
});

/**
 * GET /api/admin/master/template.xlsx — a blank sheet with the exact headers,
 * so the admin never has to guess the column names.
 */
export const downloadTemplate = asyncHandler(async (req, res) => {
  const headers = [
    'Sl No.', 'district_name', 'district_id', 'block_name', 'block_id',
    'cluster_name', 'cluster_id', 'school_code', 'school_name',
    'lowest_class', 'highest_class', 'school_assam_category', 'school_management',
    'contact_name', 'contact_number', 'email_id', 'location',
    'assembly_name', 'parliament_name',
    'bank_account_number', 'bank_name', 'bank_branch', 'bank_ifsc_code',
  ];
  const example = [
    1, 'Dhubri', '1801', 'Dhubri', '180101',
    'Dhubri Cluster 1', '18010101', '18010100101', 'Ghoramara LP School',
    'I', 'V', 'Primary', 'Government',
    'Md Abdul Rahman', '9435012345', 'ghoramara.lp@assam.gov.in', 'Ghoramara, Dhubri',
    'Dhubri', 'Dhubri', '30012345678', 'State Bank of India', 'Dhubri', 'SBIN0007654',
  ];

  const wb = buildWorkbook({
    sheetName: 'School Master',
    headers,
    rows: [example],
    title: 'Vidyaposhan · School Master Template — replace the example row with your data',
  });

  await sendWorkbook(res, wb, `vidyaposhan-master-template-${todayStamp()}.xlsx`);
});

/* ------------------------------------------------------------------ *
 * Login provisioning
 * ------------------------------------------------------------------ */

/**
 * POST /api/admin/provision/preview — which logins does the current master
 * data need, and which already exist.
 */
export const previewProvisioning = asyncHandler(async (req, res) => {
  const plan = await planProvisioning(req.body || {});
  res.json({
    success: true,
    ...plan,
    // The full list can be long; the admin UI pages through it.
    toCreate: plan.toCreate.map((c) => ({
      userId: c.userId, role: c.role, name: c.name, scope: c.scope,
    })),
  });
});

/**
 * POST /api/admin/provision/commit — create the logins.
 * The response carries the passwords once; they are hashed in the database.
 */
export const commitProvisioningEndpoint = asyncHandler(async (req, res) => {
  const { userIds, uniquePasswords = false, password, ...scope } = req.body || {};

  const plan = await planProvisioning(scope);
  let target = plan.toCreate;

  // The admin may tick a subset in the preview table.
  if (Array.isArray(userIds) && userIds.length) {
    const wanted = new Set(userIds);
    target = target.filter((c) => wanted.has(c.userId));
  }

  if (!target.length) {
    throw ApiError.badRequest('Nothing to create — every login for this scope already exists.');
  }

  const result = await commitProvisioning({ plan: target, uniquePasswords, password });

  await logAudit({
    req,
    action: AUDIT_ACTIONS.USER_CREATED,
    detail: `Provisioned ${result.created.length} login(s) from master data`,
  });

  res.status(201).json({
    success: true,
    created: result.created,
    failed: result.failed,
    notice: 'These passwords are shown only once. Download or copy them now.',
  });
});

/**
 * POST /api/admin/provision/export.xlsx — the credential sheet to hand out.
 * Runs against a fresh commit result posted back by the admin UI.
 */
export const exportCredentials = asyncHandler(async (req, res) => {
  const { created } = req.body || {};
  if (!Array.isArray(created) || !created.length) {
    throw ApiError.badRequest('Post the "created" list returned by the provisioning step.');
  }

  const headers = ['User ID', 'Name', 'Role', 'Assigned To', 'Password'];
  const rows = created.map((c) => [c.userId, c.name, c.role, c.scope, c.password]);

  const wb = buildWorkbook({
    sheetName: 'Logins',
    headers,
    rows,
    title: `Vidyaposhan · Login Credentials · ${todayStamp()} — HANDLE CONFIDENTIALLY`,
  });

  await logAudit({ req, action: AUDIT_ACTIONS.EXPORT, detail: `Credential sheet — ${rows.length} login(s)` });
  await sendWorkbook(res, wb, `vidyaposhan-logins-${todayStamp()}.xlsx`);
});

/* ------------------------------------------------------------------ *
 * Hierarchy overview
 * ------------------------------------------------------------------ */

/**
 * GET /api/admin/hierarchy — District → Block → School counts with the
 * login coverage at each level, so gaps are obvious.
 */
export const getHierarchy = asyncHandler(async (_req, res) => {
  const offices = await DcOffice.find().sort({ district: 1 }).lean();
  const blocks = await Block.find().sort({ name: 1 }).lean();

  const [schoolsByBlock, usersByRole] = await Promise.all([
    School.aggregate([
      { $group: { _id: '$blockRef', schools: { $sum: 1 },
                  payable: { $sum: { $cond: [{ $and: [
                    { $ne: ['$bank.accountNumber', ''] }, { $ne: ['$bank.ifsc', ''] }] }, 1, 0] } } } },
    ]),
    User.aggregate([{ $group: { _id: { role: '$role', school: '$school', block: '$block', dc: '$dcOffice' } } }]),
  ]);

  const schoolMap = new Map(schoolsByBlock.map((s) => [String(s._id), s]));
  const blockLogins = new Set(
    usersByRole.filter((u) => u._id.role === ROLES.BLOCK).map((u) => String(u._id.block))
  );
  const dcLogins = new Set(
    usersByRole.filter((u) => u._id.role === ROLES.DC).map((u) => String(u._id.dc))
  );
  const makerSchools = new Set(
    usersByRole.filter((u) => u._id.role === ROLES.SCHOOL_MAKER).map((u) => String(u._id.school))
  );
  const checkerSchools = new Set(
    usersByRole.filter((u) => u._id.role === ROLES.SCHOOL_CHECKER).map((u) => String(u._id.school))
  );

  const schoolsWithIds = await School.find().select('_id blockRef').lean();
  const perBlockLogins = new Map();
  for (const s of schoolsWithIds) {
    const key = String(s.blockRef);
    const e = perBlockLogins.get(key) || { makers: 0, checkers: 0 };
    if (makerSchools.has(String(s._id))) e.makers++;
    if (checkerSchools.has(String(s._id))) e.checkers++;
    perBlockLogins.set(key, e);
  }

  const tree = offices.map((o) => {
    const own = blocks.filter((b) => String(b.dcOffice) === String(o._id));
    return {
      districtId: o.districtId,
      district: o.district,
      dcOffice: o.name,
      hasLogin: dcLogins.has(String(o._id)),
      blocks: own.map((b) => {
        const s = schoolMap.get(String(b._id)) || { schools: 0, payable: 0 };
        const l = perBlockLogins.get(String(b._id)) || { makers: 0, checkers: 0 };
        return {
          blockId: b.blockId,
          block: b.name,
          hasLogin: blockLogins.has(String(b._id)),
          schools: s.schools,
          payableSchools: s.payable,
          schoolLogins: { makers: l.makers, checkers: l.checkers },
        };
      }),
    };
  });

  const totals = {
    districts: offices.length,
    blocks: blocks.length,
    schools: await School.countDocuments(),
    claims: await Claim.countDocuments(),
    logins: await User.countDocuments(),
    missingDcLogins: offices.filter((o) => !dcLogins.has(String(o._id))).length,
    missingBlockLogins: blocks.filter((b) => !blockLogins.has(String(b._id))).length,
  };

  res.json({ success: true, totals, hierarchy: tree });
});
