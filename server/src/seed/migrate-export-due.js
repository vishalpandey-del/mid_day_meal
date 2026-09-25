/**
 * `exportDue` decides whether a bill still belongs in a beneficiary file.
 *
 * Claims raised before the field existed have no value for it, and Mongoose
 * only applies a default when a document is written. Left alone they would
 * read as undefined — which the export treats as due — so a bill already
 * downloaded would come back the first time anyone exported again.
 *
 * This sets it from what each bill has already been through:
 *   never exported      → due
 *   exported and paid   → not due, the money has gone
 *   exported, not paid  → not due, it is already in a file someone holds
 *
 *   node src/seed/migrate-export-due.js
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import Claim from '../models/Claim.js';
import { PAYMENT_STATUS } from '../config/constants.js';

const run = async () => {
  await connectDB();

  const missing = await Claim.countDocuments({ exportDue: { $exists: false } });
  if (!missing) {
    console.log('Every claim already carries exportDue — nothing to do.');
    await disconnectDB();
    return;
  }
  console.log(`${missing} claim(s) predate the field.\n`);

  const neverExported = await Claim.updateMany(
    { exportDue: { $exists: false }, lastExportedAt: null },
    { $set: { exportDue: true } }
  );
  console.log(`  never exported      → due          : ${neverExported.modifiedCount}`);

  const reversed = await Claim.updateMany(
    { exportDue: { $exists: false }, paymentStatus: PAYMENT_STATUS.REVERSED },
    { $set: { exportDue: true } }
  );
  console.log(`  bounced, owed again → due          : ${reversed.modifiedCount}`);

  const rest = await Claim.updateMany(
    { exportDue: { $exists: false } },
    { $set: { exportDue: false } }
  );
  console.log(`  already downloaded  → not due      : ${rest.modifiedCount}`);

  const left = await Claim.countDocuments({ exportDue: { $exists: false } });
  console.log(`\nRemaining without the field: ${left}`);
  await disconnectDB();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
