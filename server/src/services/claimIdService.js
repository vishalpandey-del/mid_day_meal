import Claim from '../models/Claim.js';

/**
 * Claim IDs follow CLM-AS-<FY>-<seq>, e.g. CLM-AS-25-00901.
 * The sequence continues from the highest existing ID for the financial year.
 */
export const generateClaimId = async () => {
  const now = new Date();
  // Indian FY starts in April.
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = String(fyStartYear).slice(-2);
  const prefix = `CLM-AS-${fy}-`;

  const latest = await Claim.findOne({ claimId: new RegExp(`^${prefix}`) })
    .sort({ claimId: -1 })
    .select('claimId')
    .lean();

  const lastSeq = latest ? parseInt(latest.claimId.slice(prefix.length), 10) : 900;
  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;
};
