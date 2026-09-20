import 'dotenv/config';
import app from './app.js';
import { connectDB, disconnectDB } from './config/db.js';

const PORT = Number(process.env.PORT) || 5000;

if (!process.env.JWT_SECRET) {
  console.error('[fatal] JWT_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const start = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    console.log(`[api] Vidyaposhan listening on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} received — shutting down.`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Do not let a hung connection block the exit forever.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    console.error('[fatal] Unhandled rejection:', err);
    server.close(() => process.exit(1));
  });
};

start().catch((err) => {
  console.error('[fatal] Failed to start:', err.message);
  process.exit(1);
});
