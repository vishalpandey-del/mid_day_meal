import mongoose from 'mongoose';

const bankSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, trim: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    ifsc: { type: String, trim: true, uppercase: true, default: '' },
    branch: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/**
 * Mirrors the SSA school master sheet. Government ids (district_id, block_id,
 * cluster_id, school_code) are the source of truth for the hierarchy — the
 * ObjectId refs below are resolved from them at import time.
 */
const schoolSchema = new mongoose.Schema(
  {
    // ---- Identity (from master: school_code, school_name) ----
    code: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },

    // ---- District (master: district_id, district_name) ----
    districtId: { type: String, trim: true, default: '', index: true },
    district: { type: String, required: true, trim: true, default: 'Dhubri', index: true },

    // ---- Block (master: block_id, block_name) ----
    blockId: { type: String, trim: true, default: '', index: true },
    block: { type: String, required: true, trim: true, index: true },

    // ---- Cluster (master: cluster_id, cluster_name) — data only, no login ----
    clusterId: { type: String, trim: true, default: '', index: true },
    cluster: { type: String, trim: true, default: '' },

    // ---- Resolved links, derived from the ids above ----
    blockRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', default: null, index: true },
    dcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', default: null, index: true },

    // ---- School attributes (master: lowest_class, highest_class, ...) ----
    lowestClass: { type: String, trim: true, default: '' },
    highestClass: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    management: { type: String, trim: true, default: '' },

    // ---- Contact (master: contact_name, contact_number, email_id, location) ----
    headTeacher: { type: String, trim: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    location: { type: String, trim: true, default: '' },

    // ---- Constituency (master: assembly_name, parliament_name) ----
    assembly: { type: String, trim: true, default: '' },
    parliament: { type: String, trim: true, default: '' },

    // ---- Banking. The beneficiary is ALWAYS the school itself (PFMS rule). ----
    bank: { type: bankSchema, default: () => ({}) },
    gstin: { type: String, trim: true, uppercase: true, default: '' },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schoolSchema.index({ name: 'text', code: 'text', headTeacher: 'text' });
schoolSchema.index({ districtId: 1, blockId: 1, clusterId: 1 });

schoolSchema.virtual('maskedAccount').get(function () {
  const acc = this.bank?.accountNumber || '';
  return acc.length > 4 ? `••••${acc.slice(-4)}` : acc;
});

/** True once the school can actually be paid through the beneficiary file. */
schoolSchema.virtual('isPayable').get(function () {
  return Boolean(this.bank?.accountNumber && this.bank?.ifsc);
});

schoolSchema.set('toJSON', { virtuals: true });
schoolSchema.set('toObject', { virtuals: true });

export default mongoose.model('School', schoolSchema);
