import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Connection smoke test — prints what is already in the target database
 * so a destructive `seed --fresh` is never run blind.
 *   npm run db:check
 */
const mask = (uri = '') => uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[db] MONGO_URI is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  console.log(`[db] connecting → ${mask(uri)}`);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  } catch (err) {
    console.error(`[db] FAILED: ${err.message}`);
    if (/bad auth/i.test(err.message)) {
      console.error('     Check the username and password in the Atlas connection string.');
    } else if (/IP|whitelist|ENOTFOUND|querySrv/i.test(err.message)) {
      console.error('     Check Atlas Network Access (IP allow list) and the cluster hostname.');
    }
    process.exit(1);
  }

  const conn = mongoose.connection;
  console.log(`[db] connected  host=${conn.host}  database=${conn.name}`);

  const cols = await conn.db.listCollections().toArray();
  if (!cols.length) {
    console.log('[db] database is empty — safe to run `npm run seed:fresh`');
  } else {
    console.log('[db] existing collections:');
    let total = 0;
    for (const c of cols.sort((a, b) => a.name.localeCompare(b.name))) {
      const n = await conn.db.collection(c.name).countDocuments();
      total += n;
      console.log(`       ${c.name.padEnd(20)} ${String(n).padStart(6)} docs`);
    }
    if (total > 0) {
      console.log(`[db] ${total} document(s) present — \`seed:fresh\` WILL DELETE all of it.`);
    }
  }

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error('[db] unexpected error:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
