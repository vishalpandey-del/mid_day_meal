import ApiError from '../utils/ApiError.js';

export const notFound = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid identifier: ${err.value}`;
  }
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value for ${field}: ${err.keyValue?.[field]}`;
  }
  // Multer reports its own failures; translate them into plain guidance.
  if (err.name === 'MulterError') {
    statusCode = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `That file is too large. Each document must be under ${process.env.VERCEL ? 4 : 10} MB.`
        : err.code === 'LIMIT_FILE_COUNT'
        ? 'Too many files in one upload.'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
        ? `Unexpected file field "${err.field}".`
        : `Upload failed: ${err.message}`;
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  }

  if (statusCode >= 500) console.error('[ERROR]', err);

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(process.env.NODE_ENV === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
};
