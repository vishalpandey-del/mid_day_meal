import mongoose from 'mongoose';

/**
 * A block sits between the schools and the district (DC) office.
 * `blockId` is the government id from the master sheet and is what the
 * import matches on; `code` stays as a short human label.
 */
const blockSchema = new mongoose.Schema(
  {
    blockId: { type: String, required: true, unique: true, trim: true, index: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    name: { type: String, required: true, trim: true, index: true },

    districtId: { type: String, trim: true, default: '', index: true },
    district: { type: String, required: true, trim: true, default: 'Dhubri', index: true },
    dcOffice: { type: mongoose.Schema.Types.ObjectId, ref: 'DcOffice', required: true, index: true },

    officerName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    totalSchools: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Block', blockSchema);
