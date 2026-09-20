import 'dotenv/config';
import mongoose from 'mongoose';
import app from '../src/app.js';

/**
 * Serverless entry point for Vercel.
 *
 * A serverless function is frozen between invocations rather than shut down,
 * so the Mongo connection is cached on the module scope and reused. Without
 * this, every request would open a new pool and Atlas would refuse connections
 * under any real load.
 */
let connection = null;

const connect = async () => {
  if (mongoose.connection.readyState === 1) return;
  if (!connection) {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set.');
    mongoose.set('strictQuery', true);
    connection = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      // Keep the pool small: many concurrent functions each hold their own.
      maxPoolSize: 5,
    });
  }
  await connection;
};

export default async function handler(req, res) {
  try {
    await connect();
  } catch (err) {
    console.error('[api] database unavailable:', err.message);
    connection = null; // let the next invocation retry
    return res.status(503).json({
      success: false,
      message: 'Database unavailable. Check MONGO_URI and the Atlas IP allow list.',
    });
  }
  return app(req, res);
}
