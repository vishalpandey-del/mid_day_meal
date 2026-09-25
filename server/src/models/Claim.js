import mongoose from 'mongoose';
import { CLAIM_STATUS, PAYMENT_STATUS, SLA } from '../config/constants.js';

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    by: { type: String, required: true },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, required: true },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    originalName: String,
    storedName: String,
    path: String,
    mimeType: String,
    sizeBytes: Number,
    kind: { type: String, enum: ['bill', 'supporting', 'query_response'], default: 'bill' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Each time an approved claim appears in a downloaded beneficiary file.
const exportMarkSchema = new mongoose.Schema(
  {
    exportedAt: { type: Date, default: Date.now },
    exportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    exportedByName: { type: String, default: '' },
    fileName: { type: String, default: '' },
    statusAtExport: { type: String, default: '' },
  },
  { _id: false }
);

const claimSchema = new mongoose.Schema(
  {
    claimId: { type: String, required: true, unique: true, index: true },
    version: { type: Number, default: 1 },
    parentClaim: { type: mongoose.Schema.Types.ObjectId, ref: 'Claim', default: null },

    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', required: true, index: true },
    dcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', required: true, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Vendor and budget head are captured before the bill details on the form.
    vendorName: { type: String, required: true, trim: true },
    vendorGstin: { type: String, trim: true, uppercase: true, default: '' },
    vendorBankAccount: { type: String, required: true, trim: true },
    vendorIfsc: { type: String, trim: true, uppercase: true, default: '' },
    vendorBankName: { type: String, trim: true, default: '' },

    category: { type: String, required: true },
    budgetHead: { type: String, required: true, index: true },

    billNumber: { type: String, required: true, trim: true },
    billDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 1 },
    description: { type: String, default: '' },

    attachments: { type: [attachmentSchema], default: [] },

    status: {
      type: String,
      enum: Object.values(CLAIM_STATUS),
      default: CLAIM_STATUS.DRAFT,
      index: true,
    },

    // Review chain — checker and block may only record a remark.
    checkerRemarks: { type: String, default: '' },
    checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    checkedAt: { type: Date, default: null },

    blockRemarks: { type: String, default: '' },
    blockReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    blockReviewedAt: { type: Date, default: null },

    dcRemarks: { type: String, default: '' },
    returnReason: { type: String, default: '' },

    queryText: { type: String, default: '' },
    queryResponse: { type: String, default: '' },
    queryRaisedAt: { type: Date, default: null },
    queryRespondedAt: { type: Date, default: null },

    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },

    // Payment tracking is DC-only and only meaningful once approved.
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
      index: true,
    },
    paidAt: { type: Date, default: null },
    paymentRef: { type: String, default: '' },
    paymentRemarks: { type: String, default: '' },

    // Reversal trail — why the money came back, and how often.
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: '' },
    reversalCount: { type: Number, default: 0 },

    // Beneficiary-export trail. Once exported, any later status change needs a remark.
    exportHistory: { type: [exportMarkSchema], default: [] },
    lastExportedAt: { type: Date, default: null, index: true },

    /*
     * Whether this bill still belongs in a beneficiary file.
     *
     * A bill goes in once. Downloading it again would ask PFMS to pay the same
     * vendor twice, and the second file gives no sign that it is a repeat. So
     * the export clears this flag, and only a real change sets it again: the
     * bill itself being edited, or its payment being undone — a payment marked
     * back to Unpaid, or one that bounced and must go out afresh.
     */
    exportDue: { type: Boolean, default: true, index: true },
    postExportRemarks: { type: String, default: '' },

    // Total days the SLA clock was paused while the claim sat Under Query.
    pausedDays: { type: Number, default: 0 },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

claimSchema.index({ school: 1, status: 1 });
claimSchema.index({ block: 1, status: 1 });
claimSchema.index({ dcOffice: 1, status: 1, submittedAt: 1 });
claimSchema.index({ dcOffice: 1, status: 1, paymentStatus: 1 });

/** Age in days since submission, excluding time parked Under Query. */
claimSchema.virtual('ageDays').get(function () {
  if (!this.submittedAt) return 0;
  const end = this.decidedAt ? new Date(this.decidedAt) : new Date();
  const raw = Math.floor((end - new Date(this.submittedAt)) / 86400000);
  let paused = this.pausedDays || 0;
  if (SLA.PAUSE_ON_QUERY && this.status === CLAIM_STATUS.UNDER_QUERY && this.queryRaisedAt) {
    paused += Math.floor((Date.now() - new Date(this.queryRaisedAt)) / 86400000);
  }
  return Math.max(0, raw - paused);
});

claimSchema.virtual('slaBucket').get(function () {
  const age = this.ageDays;
  if (age >= SLA.BREACH_DAY) return 'breached';
  if (age >= SLA.REMINDER_DAY) return 'reminder';
  return 'normal';
});

claimSchema.virtual('amountInLakhs').get(function () {
  return Number((this.amount / 100000).toFixed(5));
});

/** True once the claim has appeared in a downloaded beneficiary file. */
claimSchema.virtual('wasExported').get(function () {
  return Boolean(this.lastExportedAt);
});

claimSchema.methods.pushHistory = function (action, user, note = '') {
  this.history.push({
    action,
    by: user?.name || 'System',
    byUser: user?._id,
    role: user?.role || 'system',
    note,
    at: new Date(),
  });
};

claimSchema.set('toJSON', { virtuals: true });
claimSchema.set('toObject', { virtuals: true });

export default mongoose.model('Claim', claimSchema);
