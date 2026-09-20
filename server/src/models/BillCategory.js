import mongoose from 'mongoose';

const billCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    budgetHead: { type: String, required: true, trim: true },
    maxAmount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('BillCategory', billCategorySchema);
