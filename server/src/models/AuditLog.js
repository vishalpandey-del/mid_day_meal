import mongoose from 'mongoose';

// Append-only: updates and deletes are blocked at the model level.
const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String, required: true },
    userId: { type: String, default: '' },
    role: { type: String, required: true },
    action: { type: String, required: true },
    claimId: { type: String, default: '' },
    detail: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ claimId: 1 });

const blockMutation = function (next) {
  next(new Error('Audit log entries are immutable.'));
};
auditLogSchema.pre('updateOne', blockMutation);
auditLogSchema.pre('updateMany', blockMutation);
auditLogSchema.pre('findOneAndUpdate', blockMutation);
auditLogSchema.pre('deleteOne', blockMutation);
auditLogSchema.pre('deleteMany', blockMutation);

export default mongoose.model('AuditLog', auditLogSchema);
