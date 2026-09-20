/**
 * The block office used to sit between the checker and the DC. It no longer
 * does, so any claim left waiting on block review would wait forever — no
 * role can act on it any more. This moves those claims on to the DC, which
 * is where the checker would send them today.
 *
 *   node src/seed/migrate-chain.js
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import Claim from '../models/Claim.js';
import { CLAIM_STATUS } from '../config/constants.js';

const run = async () => {
  await connectDB();

  const stranded = await Claim.find({ status: CLAIM_STATUS.PENDING_BLOCK })
    .select('claimId submittedAt checkedAt createdAt');

  if (!stranded.length) {
    console.log('Nothing waiting on block review — no claim is stranded.');
    await disconnectDB();
    return;
  }

  console.log(`${stranded.length} claim(s) waiting on a stage that no longer exists:`);
  for (const c of stranded) {
    // The SLA clock starts at the DC. These claims never reached it, so it
    // starts from when the checker passed them, not from now — otherwise
    // every one of them would look freshly filed.
    c.status = CLAIM_STATUS.SUBMITTED;
    c.submittedAt = c.submittedAt || c.checkedAt || c.createdAt;
    await c.save();
    console.log(`  ${c.claimId} → Submitted (with the DC)`);
  }

  console.log(`\nMoved ${stranded.length} claim(s) to the DC.`);
  await disconnectDB();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
