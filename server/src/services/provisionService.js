import crypto from 'node:crypto';
import User from '../models/User.js';
import School from '../models/School.js';
import Block from '../models/Block.js';
import DcOffice from '../models/DcOffice.js';
import { ROLES } from '../config/constants.js';

/**
 * Turns imported master data into login accounts.
 *
 * User ids are derived from the government ids so they are stable across
 * re-imports: a second upload never creates a duplicate login for a school.
 */

export const USER_ID_PATTERN = {
  [ROLES.SCHOOL_MAKER]: (code) => `MKR${code}`,
  [ROLES.SCHOOL_CHECKER]: (code) => `CHK${code}`,
  [ROLES.BLOCK]: (blockId) => `BLK${blockId}`,
  [ROLES.DC]: (districtId) => `DC${districtId}`,
};

/** Default passwords, per role. Users are expected to change these on first login. */
export const DEFAULT_PASSWORD = {
  [ROLES.SCHOOL_MAKER]: 'School@123',
  [ROLES.SCHOOL_CHECKER]: 'School@123',
  [ROLES.BLOCK]: 'Block@123',
  [ROLES.DC]: 'District@123',
};

/** A readable random password, for when the admin wants unique ones. */
export const randomPassword = () => {
  const n = crypto.randomInt(1000, 9999);
  const w = ['Vidya', 'Poshan', 'Shiksha', 'Setu', 'Kiran'][crypto.randomInt(0, 5)];
  return `${w}@${n}`;
};

/**
 * Works out which logins are missing for the current master data.
 * Nothing is written — this is what the admin previews before committing.
 */
export const planProvisioning = async ({ districtId, blockId, roles } = {}) => {
  const wanted = roles?.length
    ? roles
    : [ROLES.DC, ROLES.BLOCK, ROLES.SCHOOL_MAKER, ROLES.SCHOOL_CHECKER];

  const dcFilter = districtId ? { districtId } : {};
  const blockFilter = { ...(districtId ? { districtId } : {}), ...(blockId ? { blockId } : {}) };

  const [offices, blocks] = await Promise.all([
    DcOffice.find({ ...dcFilter, isActive: true }).lean(),
    Block.find({ ...blockFilter, isActive: true }).lean(),
  ]);

  const schoolFilter = { isActive: true };
  if (blockId) {
    const blk = blocks.find((b) => b.blockId === blockId);
    if (blk) schoolFilter.blockRef = blk._id;
  } else if (districtId) {
    const office = offices.find((o) => o.districtId === districtId);
    if (office) schoolFilter.dcOffice = office._id;
  }
  const schools = await School.find(schoolFilter).select('code name blockRef dcOffice headTeacher mobile email').lean();

  const candidates = [];
  const push = (userId, role, name, scope, extra = {}) =>
    candidates.push({ userId, role, name, scope, ...extra });

  if (wanted.includes(ROLES.DC)) {
    for (const o of offices) {
      push(USER_ID_PATTERN[ROLES.DC](o.districtId), ROLES.DC, o.officerName || `DC ${o.district}`,
        `District: ${o.district}`, { dcOffice: o._id, designation: 'Bill Section Officer', email: o.email || '' });
    }
  }

  if (wanted.includes(ROLES.BLOCK)) {
    for (const b of blocks) {
      push(USER_ID_PATTERN[ROLES.BLOCK](b.blockId), ROLES.BLOCK, b.officerName || `BEEO ${b.name}`,
        `Block: ${b.name}`, { block: b._id, designation: 'Block Elementary Education Officer', email: b.email || '' });
    }
  }

  for (const s of schools) {
    if (wanted.includes(ROLES.SCHOOL_MAKER)) {
      push(USER_ID_PATTERN[ROLES.SCHOOL_MAKER](s.code), ROLES.SCHOOL_MAKER, s.headTeacher || s.name,
        `School: ${s.name}`, { school: s._id, designation: 'Head Teacher (Maker)', mobile: s.mobile || '', email: s.email || '' });
    }
    if (wanted.includes(ROLES.SCHOOL_CHECKER)) {
      push(USER_ID_PATTERN[ROLES.SCHOOL_CHECKER](s.code), ROLES.SCHOOL_CHECKER, `${s.name} — Checker`,
        `School: ${s.name}`, { school: s._id, designation: 'Reviewing Authority (Checker)', email: s.email || '' });
    }
  }

  // Split into what is new and what already exists.
  const ids = candidates.map((c) => c.userId);
  const existing = new Set(
    (await User.find({ userId: { $in: ids } }).select('userId').lean()).map((u) => u.userId)
  );

  const toCreate = candidates.filter((c) => !existing.has(c.userId));
  const alreadyExists = candidates.filter((c) => existing.has(c.userId));

  const countBy = (list) =>
    list.reduce((acc, c) => ({ ...acc, [c.role]: (acc[c.role] || 0) + 1 }), {});

  return {
    summary: {
      districts: offices.length,
      blocks: blocks.length,
      schools: schools.length,
      toCreate: toCreate.length,
      alreadyExists: alreadyExists.length,
      byRole: countBy(toCreate),
    },
    toCreate,
    alreadyExists: alreadyExists.map((c) => ({ userId: c.userId, role: c.role, scope: c.scope })),
  };
};

/**
 * Creates the planned logins. Returns the credential list once — the admin
 * must hand these out, because passwords are hashed and cannot be read back.
 */
export const commitProvisioning = async ({ plan, uniquePasswords = false, password }) => {
  const created = [];
  const failed = [];

  for (const c of plan) {
    const pwd = password || (uniquePasswords ? randomPassword() : DEFAULT_PASSWORD[c.role] || 'Vidya@123');
    try {
      if (await User.exists({ userId: c.userId })) {
        failed.push({ userId: c.userId, reason: 'Login already exists' });
        continue;
      }
      await User.create({
        userId: c.userId,
        name: c.name,
        password: pwd,
        role: c.role,
        school: c.school || null,
        block: c.block || null,
        dcOffice: c.dcOffice || null,
        designation: c.designation || '',
        email: c.email || '',
        mobile: c.mobile || '',
      });
      created.push({ userId: c.userId, role: c.role, name: c.name, scope: c.scope, password: pwd });
    } catch (err) {
      failed.push({ userId: c.userId, reason: err.message });
    }
  }

  return { created, failed };
};
