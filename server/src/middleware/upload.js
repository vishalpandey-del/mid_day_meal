import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ApiError from '../utils/ApiError.js';
import FileBlob from '../models/FileBlob.js';

/**
 * Bill documents are held in memory by multer and then written to MongoDB by
 * `persistFiles`. A serverless filesystem is wiped between invocations, so
 * disk storage would lose every upload; the database is the one place that
 * survives. `uploadDir` remains for local installs that predate this.
 */
const onServerless = Boolean(process.env.VERCEL);
const uploadDir = onServerless
  ? path.join('/tmp', 'uploads')
  : path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  console.warn(`[upload] could not create ${uploadDir}: ${err.message}`);
}

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

// MongoDB refuses a document over 16 MB, so the cap stays safely below it.
const maxMb = Math.min(Number(process.env.MAX_UPLOAD_MB || 10), 15);

const billFilter = (_req, file, cb) => {
  if (!ALLOWED.includes(file.mimetype)) {
    return cb(ApiError.badRequest('Only PDF, JPEG or PNG files are accepted.'));
  }
  cb(null, true);
};

export const uploadBill = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: billFilter,
});

/** Excel imports are parsed in-memory; nothing is written to disk. */
export const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (!ok) return cb(ApiError.badRequest('Upload an .xlsx workbook.'));
    cb(null, true);
  },
});

/** A collision-proof name that also keeps the original extension. */
const storedNameFor = (file) => {
  const ext = path.extname(file.originalname).toLowerCase();
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
};

/**
 * Writes the uploaded buffers into MongoDB and returns attachment records
 * ready to sit on the claim.
 */
export const persistFiles = async (files = [], { kind = 'bill', user, claimId } = {}) => {
  if (!files.length) return [];

  const docs = files.map((f) => ({
    storedName: storedNameFor(f),
    originalName: f.originalname,
    mimeType: f.mimetype,
    sizeBytes: f.size,
    data: f.buffer,
    claim: claimId || null,
    uploadedBy: user?._id,
  }));

  await FileBlob.insertMany(docs);

  return docs.map((d) => ({
    originalName: d.originalName,
    storedName: d.storedName,
    path: d.storedName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    kind,
    uploadedAt: new Date(),
  }));
};

/**
 * Reads a stored file back. Older local installs kept files on disk, so that
 * path is still checked before giving up.
 */
export const readFile = async (storedName) => {
  const blob = await FileBlob.findOne({ storedName }).lean();
  if (blob) {
    // Mongoose hands back its own binary wrapper, whose `length` is a method
    // rather than a number. Normalise to a real Buffer so byte counts and
    // Content-Length behave.
    const buffer = Buffer.isBuffer(blob.data) ? blob.data : Buffer.from(blob.data.buffer || blob.data);
    return { buffer, mimeType: blob.mimeType, originalName: blob.originalName };
  }

  const abs = path.join(uploadDir, path.basename(storedName));
  if (fs.existsSync(abs)) {
    return { buffer: fs.readFileSync(abs), mimeType: null, originalName: path.basename(abs) };
  }
  return null;
};

/** Removes stored files, used when a draft claim is deleted. */
export const removeFiles = async (storedNames = []) => {
  if (!storedNames.length) return;
  await FileBlob.deleteMany({ storedName: { $in: storedNames } });
  for (const n of storedNames) {
    fs.promises.unlink(path.join(uploadDir, path.basename(n))).catch(() => {});
  }
};

export { uploadDir };
