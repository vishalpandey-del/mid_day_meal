import mongoose from 'mongoose';

/**
 * Bill documents stored as bytes in MongoDB.
 *
 * A serverless filesystem is wiped between invocations, so uploads cannot live
 * on disk. Keeping them in their own collection — rather than inside the claim
 * — means a claim listing never drags megabytes of PDF along with it.
 *
 * MongoDB caps a single document at 16 MB, which the upload limit stays under.
 */
const fileBlobSchema = new mongoose.Schema(
  {
    storedName: { type: String, required: true, unique: true, index: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    data: { type: Buffer, required: true },

    // Kept for the audit trail and for cleaning up orphans later.
    claim: { type: mongoose.Schema.Types.ObjectId, ref: 'Claim', default: null, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('FileBlob', fileBlobSchema);
