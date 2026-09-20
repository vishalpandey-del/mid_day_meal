import mongoose from 'mongoose';

const revisionSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    previousAmount: { type: Number, default: 0 },
    by: { type: String, required: true },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * Budget flows downward in two hops: State allocates to a DC office, the DC
 * office allocates to its schools. One document per (level, owner, FY, head).
 */
const budgetSchema = new mongoose.Schema(
  {
    level: { type: String, required: true, enum: ['dc', 'school'], index: true },

    // Exactly one of these is set, matching `level`.
    dcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', default: null, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },

    // Denormalised so DC-level rollups do not need a school lookup.
    parentDcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', default: null, index: true },

    financialYear: { type: String, required: true, index: true },
    budgetHead: { type: String, required: true, trim: true, index: true },

    allocated: { type: Number, required: true, min: 0, default: 0 },
    allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
    revisions: { type: [revisionSchema], default: [] },
  },
  { timestamps: true }
);

// One budget row per owner, per head, per year.
budgetSchema.index(
  { level: 1, dcOffice: 1, school: 1, financialYear: 1, budgetHead: 1 },
  { unique: true }
);

/** Indian FY label for a date, e.g. 2026-05-10 → "2026-27". */
budgetSchema.statics.fyLabel = function (date = new Date()) {
  const d = new Date(date);
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

export default mongoose.model('Budget', budgetSchema);
