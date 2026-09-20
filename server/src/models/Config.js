import mongoose from 'mongoose';
import { SLA } from '../config/constants.js';

// Single-document store for SLA + notification matrix, editable by State.
const configSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    sla: {
      normalDays: { type: Number, default: SLA.NORMAL_DAYS },
      reminderDay: { type: Number, default: SLA.REMINDER_DAY },
      breachDay: { type: Number, default: SLA.BREACH_DAY },
      pauseOnQuery: { type: Boolean, default: SLA.PAUSE_ON_QUERY },
    },
    // Warn when a claim pushes a school past its allocation, but never block it.
    budget: {
      warnOnOverspend: { type: Boolean, default: true },
      blockOnOverspend: { type: Boolean, default: false },
    },
    notifications: {
      type: [
        {
          _id: false,
          event: String,
          recipient: String,
          inApp: { type: Boolean, default: true },
          email: { type: Boolean, default: true },
          sms: { type: Boolean, default: true },
        },
      ],
      default: [
        { event: 'Claim submitted by maker', recipient: 'School Checker', inApp: true, email: true, sms: false },
        { event: 'Claim forwarded by checker', recipient: 'Block Office', inApp: true, email: true, sms: false },
        { event: 'Claim forwarded by block', recipient: 'DC Office', inApp: true, email: true, sms: true },
        { event: 'Claim returned for correction', recipient: 'School Maker', inApp: true, email: true, sms: true },
        { event: 'Under Query raised', recipient: 'School', inApp: true, email: true, sms: true },
        { event: 'Claim Approved', recipient: 'School', inApp: true, email: true, sms: true },
        { event: 'Claim Rejected', recipient: 'School', inApp: true, email: true, sms: true },
        { event: 'Payment marked Paid', recipient: 'School', inApp: true, email: true, sms: true },
        { event: 'SLA Reminder (Day 7)', recipient: 'DC + Block', inApp: true, email: true, sms: false },
        { event: 'Budget allocated', recipient: 'DC / School', inApp: true, email: true, sms: false },
      ],
    },
  },
  { timestamps: true }
);

configSchema.statics.getGlobal = async function () {
  let cfg = await this.findOne({ key: 'global' });
  if (!cfg) cfg = await this.create({ key: 'global' });
  return cfg;
};

export default mongoose.model('Config', configSchema);
