import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ApiError from '../utils/ApiError.js';

/**
 * Serverless platforms give a read-only filesystem apart from /tmp, so the
 * upload directory follows the environment: a real folder locally, /tmp when
 * running on Vercel. Files written to /tmp do not survive between invocations,
 * so object storage is the next step for production uploads.
 */
const onServerless = Boolean(process.env.VERCEL);
const uploadDir = onServerless
  ? path.join('/tmp', 'uploads')
  : path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  // A read-only root should not stop the API from booting; only uploads fail.
  console.warn(`[upload] could not create ${uploadDir}: ${err.message}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];

export const uploadBill = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(ApiError.badRequest('Only PDF, JPEG or PNG files are accepted.'));
    }
    cb(null, true);
  },
});

/** Excel imports are parsed in-memory; nothing is written to disk. */
export const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (!ok) return cb(ApiError.badRequest('Upload an .xlsx workbook.'));
    cb(null, true);
  },
});

export { uploadDir };
