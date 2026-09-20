import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../config/constants.js';

// One entry per posting the user has held. The current posting is the last
// entry with no `until` date; older entries keep the transfer trail readable.
const postingSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', default: null },
    dcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', default: null },
    placeLabel: { type: String, default: '' },
    from: { type: Date, default: Date.now },
    until: { type: Date, default: null },
    note: { type: String, default: '' },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true, select: false, minlength: 6 },
    role: { type: String, required: true, enum: Object.values(ROLES), index: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    mobile: { type: String, trim: true, default: '' },

    // Current scope: school roles bind to a school, block to a block, DC to
    // a DC office. A transfer rewrites these, so the user immediately sees
    // the new place and stops seeing the old one.
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },
    block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', default: null, index: true },
    dcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', default: null, index: true },

    designation: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },

    // Posting history — who sat where, and when they moved.
    postings: { type: [postingSchema], default: [] },
    transferredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

/** The posting the user currently holds. */
userSchema.virtual('currentPosting').get(function () {
  return this.postings?.find((p) => !p.until) || null;
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

export default mongoose.model('User', userSchema);
