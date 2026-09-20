import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    icon: { type: String, default: '🔔' },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    claim: { type: mongoose.Schema.Types.ObjectId, ref: 'Claim', default: null },
    claimId: { type: String, default: '' },
    channels: { type: [String], default: ['in_app'] },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
