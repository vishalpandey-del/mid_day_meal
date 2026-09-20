import User from '../models/User.js';
import School from '../models/School.js';
import Block from '../models/Block.js';
import DcOffice from '../models/DcOffice.js';
import ApiError from '../utils/ApiError.js';
import { ROLES, SCHOOL_ROLES } from '../config/constants.js';

/**
 * Moving an officer to a new posting.
 *
 * The scope fields on the user are rewritten, so the very next request shows
 * the new place and nothing from the old one. Claims already actioned keep
 * the actor's name in their own history, so the audit trail stays truthful.
 */

/** Resolves the destination and returns the scope patch for that role. */
export const resolveDestination = async ({ role, schoolId, blockId, districtId }) => {
  if (SCHOOL_ROLES.includes(role)) {
    if (!schoolId) throw ApiError.badRequest('Choose the school to post this user to.');
    const school = await School.findOne(
      schoolId.match(/^[0-9a-fA-F]{24}$/) ? { _id: schoolId } : { code: schoolId }
    ).populate('blockRef', 'name');
    if (!school) throw ApiError.notFound(`School not found: ${schoolId}`);
    if (!school.isActive) throw ApiError.badRequest(`${school.name} is deactivated.`);
    return {
      scope: { school: school._id, block: null, dcOffice: null },
      placeLabel: `${school.name} (${school.code})`,
      target: school,
    };
  }

  if (role === ROLES.BLOCK) {
    if (!blockId) throw ApiError.badRequest('Choose the block to post this user to.');
    const block = await Block.findOne(
      blockId.match(/^[0-9a-fA-F]{24}$/) ? { _id: blockId } : { blockId }
    );
    if (!block) throw ApiError.notFound(`Block not found: ${blockId}`);
    if (!block.isActive) throw ApiError.badRequest(`${block.name} block is deactivated.`);
    return {
      scope: { school: null, block: block._id, dcOffice: null },
      placeLabel: `${block.name} block (${block.blockId})`,
      target: block,
    };
  }

  if (role === ROLES.DC) {
    if (!districtId) throw ApiError.badRequest('Choose the district to post this user to.');
    const office = await DcOffice.findOne(
      districtId.match(/^[0-9a-fA-F]{24}$/) ? { _id: districtId } : { districtId }
    );
    if (!office) throw ApiError.notFound(`District not found: ${districtId}`);
    if (!office.isActive) throw ApiError.badRequest(`${office.district} office is deactivated.`);
    return {
      scope: { school: null, block: null, dcOffice: office._id },
      placeLabel: `${office.district} district (${office.districtId})`,
      target: office,
    };
  }

  // State and admin are not tied to a place, so there is nothing to transfer.
  throw ApiError.badRequest(
    `The "${role}" role covers the whole state and has no posting to transfer.`
  );
};

/** A readable label for wherever the user sits right now. */
export const describeCurrentPosting = async (user) => {
  if (user.school) {
    const s = await School.findById(user.school).select('name code');
    return s ? `${s.name} (${s.code})` : 'Unknown school';
  }
  if (user.block) {
    const b = await Block.findById(user.block).select('name blockId');
    return b ? `${b.name} block (${b.blockId})` : 'Unknown block';
  }
  if (user.dcOffice) {
    const d = await DcOffice.findById(user.dcOffice).select('district districtId');
    return d ? `${d.district} district (${d.districtId})` : 'Unknown district';
  }
  return 'No posting (state-wide)';
};

/**
 * Transfers a user to a new posting, optionally changing their role
 * (for example a block officer promoted into the DC office).
 */
export const transferUser = async ({ user, destination, newRole, note, actor }) => {
  const role = newRole || user.role;
  const { scope, placeLabel } = await resolveDestination({ role, ...destination });

  const fromLabel = await describeCurrentPosting(user);
  if (
    String(user.school || '') === String(scope.school || '') &&
    String(user.block || '') === String(scope.block || '') &&
    String(user.dcOffice || '') === String(scope.dcOffice || '') &&
    role === user.role
  ) {
    throw ApiError.badRequest(`${user.name} is already posted at ${placeLabel}.`);
  }

  // Close the open posting, if this user has one recorded.
  const open = user.postings.find((p) => !p.until);
  if (open) {
    open.until = new Date();
  } else {
    // Backfill the posting the user held before transfers were tracked.
    user.postings.push({
      role: user.role,
      school: user.school,
      block: user.block,
      dcOffice: user.dcOffice,
      placeLabel: fromLabel,
      from: user.createdAt || new Date(),
      until: new Date(),
      note: 'Original posting',
    });
  }

  user.role = role;
  user.school = scope.school;
  user.block = scope.block;
  user.dcOffice = scope.dcOffice;
  user.transferredAt = new Date();

  user.postings.push({
    role,
    ...scope,
    placeLabel,
    from: new Date(),
    until: null,
    note: note || '',
    byUser: actor?._id,
  });

  await user.save({ validateBeforeSave: false });

  return { from: fromLabel, to: placeLabel, role };
};

/**
 * What a transfer would disturb: work still sitting in this user's queue at
 * the place they are leaving. The admin sees this before confirming.
 */
export const pendingWorkAt = async (user) => {
  const { default: Claim } = await import('../models/Claim.js');
  const { CLAIM_STATUS } = await import('../config/constants.js');

  const queues = {
    [ROLES.SCHOOL_MAKER]: [CLAIM_STATUS.DRAFT, CLAIM_STATUS.RETURNED, CLAIM_STATUS.UNDER_QUERY],
    [ROLES.SCHOOL_CHECKER]: [CLAIM_STATUS.PENDING_CHECKER],
    [ROLES.BLOCK]: [CLAIM_STATUS.PENDING_BLOCK],
    [ROLES.DC]: [CLAIM_STATUS.SUBMITTED, CLAIM_STATUS.RESUBMITTED, CLAIM_STATUS.UNDER_QUERY],
  };

  const statuses = queues[user.role];
  if (!statuses) return { count: 0, claims: [] };

  const scope = user.school
    ? { school: user.school }
    : user.block
    ? { block: user.block }
    : user.dcOffice
    ? { dcOffice: user.dcOffice }
    : null;
  if (!scope) return { count: 0, claims: [] };

  const claims = await Claim.find({ ...scope, status: { $in: statuses } })
    .select('claimId status amount')
    .limit(20)
    .lean();

  return {
    count: await Claim.countDocuments({ ...scope, status: { $in: statuses } }),
    claims,
    note:
      'These claims stay with the post, not the person. Whoever holds this ' +
      'posting next will see them.',
  };
};
