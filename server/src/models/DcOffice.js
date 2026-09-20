import mongoose from 'mongoose';

/**
 * One district = one DC office. `districtId` is the government id from the
 * master sheet and is what the import matches on.
 */
const dcOfficeSchema = new mongoose.Schema(
  {
    districtId: { type: String, required: true, unique: true, trim: true, index: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    name: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true, index: true },

    officerName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    mobile: { type: String, trim: true, default: '' },
    totalBlocks: { type: Number, default: 0 },
    totalSchools: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('DcOffice', dcOfficeSchema);
