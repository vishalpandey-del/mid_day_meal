/**
 * A reversal used to park a bill in a state of its own, "Payment Reversed",
 * and the desk grew a tab to hold it. It no longer does: the money came back,
 * so the bill is unpaid again and takes the same road as any other — Awaiting,
 * a file, Paid.
 *
 * Bills reversed under the old rule still carry that state. No tab asks for it
 * any more, so they are invisible: owed money, and nowhere to be seen. This
 * returns them to the start, keeping the reversal on the record.
 *
 *   node src/seed/migrate-reversed.js
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import Claim from '../models/Claim.js';
import { PAYMENT_STATUS } from '../config/constants.js';

const run = async () => {
  await connectDB();

  const stranded = await Claim.find({ paymentStatus: PAYMENT_STATUS.REVERSED })
    .select('claimId amount reversalCount reversalReason');

  if (!stranded.length) {
    console.log('No bill is left in the old reversed state.');
    await disconnectDB();
    return;
  }

  console.log(`${stranded.length} bill(s) are parked in "Payment Reversed":\n`);

  const result = await Claim.updateMany(
    { paymentStatus: PAYMENT_STATUS.REVERSED },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.UNPAID,
        // Owed again, so it belongs in the next payment file.
        exportDue: true,
        paidAt: null,
        paymentRef: '',
      },
    },
  );

  stranded.slice(0, 10).forEach((c) => {
    console.log(`  ${c.claimId} → Awaiting payment` +
      (c.reversalCount ? ` (reversed ${c.reversalCount}\u00d7)` : ''));
  });
  if (stranded.length > 10) console.log(`  … and ${stranded.length - 10} more`);

  console.log(`\nMoved ${result.modifiedCount} bill(s) back to Awaiting Payment.`);
  console.log('Their reversal count and reason are untouched.');

  const left = await Claim.countDocuments({ paymentStatus: PAYMENT_STATUS.REVERSED });
  console.log(`Remaining in the old state: ${left}`);
  await disconnectDB();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
