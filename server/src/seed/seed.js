import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import School from '../models/School.js';
import Block from '../models/Block.js';
import DcOffice from '../models/DcOffice.js';
import BillCategory from '../models/BillCategory.js';
import Claim from '../models/Claim.js';
import Budget from '../models/Budget.js';
import Config from '../models/Config.js';
import AuditLog from '../models/AuditLog.js';
import Notification from '../models/Notification.js';
import { CLAIM_STATUS, AUDIT_ACTIONS, PAYMENT_STATUS, ROLES } from '../config/constants.js';

const FRESH = process.argv.includes('--fresh');

// Ids mirror the government master sheet: district 1801, blocks 18010x.
const DISTRICT_ID = '1801';
const BLOCKS = [
  { blockId: '180101', code: 'BLK-DHU', name: 'Dhubri' },
  { blockId: '180102', code: 'BLK-BIL', name: 'Bilasipara' },
  { blockId: '180103', code: 'BLK-GAU', name: 'Gauripur' },
  { blockId: '180104', code: 'BLK-CHP', name: 'Chapar-Salkocha' },
  { blockId: '180105', code: 'BLK-RUP', name: 'Rupshi' },
  { blockId: '180106', code: 'BLK-GOL', name: 'Golakganj' },
  { blockId: '180107', code: 'BLK-MAH', name: 'Mahamaya' },
  { blockId: '180108', code: 'BLK-AGO', name: 'Agomani' },
];

const CATEGORIES = [
  { name: 'Mid Day Meal', budgetHead: 'MDM-2202-01', maxAmount: 500000 },
  { name: 'School Maintenance Grant', budgetHead: 'SMG-2202-02', maxAmount: 100000 },
  { name: 'Composite School Grant', budgetHead: 'CSG-2202-03', maxAmount: 75000 },
  { name: 'Library & Sports', budgetHead: 'LIB-2202-04', maxAmount: 50000 },
  { name: 'Uniform & Textbooks', budgetHead: 'UTB-2202-05', maxAmount: 300000 },
  { name: 'Civil Works / Repair', budgetHead: 'CWR-2202-06', maxAmount: 1000000 },
  { name: 'ICT & Digital Lab', budgetHead: 'ICT-2202-07', maxAmount: 250000 },
  { name: 'Teacher Training (TLM)', budgetHead: 'TLM-2202-08', maxAmount: 60000 },
];

const VENDORS = [
  { name: 'Brahmaputra Traders', gstin: '18AABCB1234C1Z5', bank: 'State Bank of India', ifsc: 'SBIN0007654' },
  { name: 'Goalpara Stationers', gstin: '18AACCG5678D1Z2', bank: 'Punjab National Bank', ifsc: 'PUNB0223400' },
  { name: 'Dhubri Hardware & Paints', gstin: '18AADCD9012E1Z8', bank: 'Union Bank of India', ifsc: 'UBIN0812345' },
  { name: 'Assam Edu Supplies Pvt Ltd', gstin: '18AAECA3456F1Z1', bank: 'State Bank of India', ifsc: 'SBIN0007654' },
  { name: 'Kamakhya Construction', gstin: '18AAFCK7890G1Z4', bank: 'Assam Gramin Vikash Bank', ifsc: 'UTBI0RRBAGV' },
  { name: 'Netra Computers', gstin: '18AAGCN2345H1Z7', bank: 'Punjab National Bank', ifsc: 'PUNB0223400' },
];

const BANKS = [
  { bankName: 'State Bank of India', ifsc: 'SBIN0007654' },
  { bankName: 'Assam Gramin Vikash Bank', ifsc: 'UTBI0RRBAGV' },
  { bankName: 'Punjab National Bank', ifsc: 'PUNB0223400' },
  { bankName: 'Union Bank of India', ifsc: 'UBIN0812345' },
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

const SCHOOL_NAMES = [
  'Ghoramara LP School', 'Bidyapara Girls HS', 'Sukchar ME Madrassa',
  'Halakura LP School', 'Tamarhat Higher Secondary', 'Bhogdohar ME School',
  'Jhagrarpar LP School', 'Salmara Model HS', 'Chapar Town LP School',
  'Birsing Jarua HS', 'Kalyani ME School', 'Panbari LP School',
  'Alomganj Girls ME', 'Sonakhuli LP School', 'Hatsingimari HS',
  'Rowmari Pt-I LP', 'Bilasipara Town HS', 'Gauripur Bidya Mandir',
  'Athiabari LP School', 'Fakirganj HS School', 'Bagribari ME School',
  'Simlabari LP School', 'Debottar LP School', 'Kachmara HS School',
];

const seed = async () => {
  await connectDB();

  if (FRESH) {
    console.log('[seed] --fresh → clearing existing collections');
    await Promise.all([
      User.deleteMany({}),
      School.deleteMany({}),
      Block.deleteMany({}),
      DcOffice.deleteMany({}),
      BillCategory.deleteMany({}),
      Claim.deleteMany({}),
      Budget.deleteMany({}),
      Config.deleteMany({}),
      Notification.deleteMany({}),
      // AuditLog blocks deleteMany at the model level, so drop via the driver.
      mongoose.connection.collection('auditlogs').deleteMany({}).catch(() => {}),
    ]);
  } else if (await User.exists({})) {
    console.log('[seed] Data already present. Re-run with --fresh to reset.');
    await disconnectDB();
    return;
  }

  await Config.getGlobal();

  /* ---------- DC office ---------- */
  const dcOffice = await DcOffice.create({
    districtId: DISTRICT_ID,
    code: 'DC-DHU',
    name: 'Office of the Deputy Commissioner, Dhubri',
    district: 'Dhubri',
    officerName: 'Sri Anjan Kumar Baruah, IAS',
    email: 'dc-dhubri@assam.gov.in',
    mobile: '9435012345',
  });

  /* ---------- Blocks ---------- */
  const blocks = await Block.insertMany(
    BLOCKS.map((b) => ({
      ...b,
      district: 'Dhubri',
      districtId: DISTRICT_ID,
      dcOffice: dcOffice._id,
      officerName: `BEEO ${b.name}`,
      email: `beeo.${b.name.toLowerCase().replace(/[^a-z]/g, '')}@assam.gov.in`,
      mobile: `94351${String(randInt(10000, 99999))}`,
    }))
  );
  console.log(`[seed] ${blocks.length} blocks`);

  /* ---------- Categories ---------- */
  const categories = await BillCategory.insertMany(CATEGORIES);
  console.log(`[seed] ${categories.length} bill categories`);

  /* ---------- Schools ---------- */
  const schools = await School.insertMany(
    SCHOOL_NAMES.map((name, i) => {
      const bank = rand(BANKS);
      const blk = blocks[i % blocks.length];
      return {
        code: `18${String(140100 + i * 7).padStart(6, '0')}`,
        name,
        districtId: DISTRICT_ID,
        district: 'Dhubri',
        blockId: blk.blockId,
        block: blk.name,
        blockRef: blk._id,
        clusterId: `${blk.blockId}${String((i % 3) + 1).padStart(2, '0')}`,
        cluster: `${blk.name} Cluster ${(i % 3) + 1}`,
        category: i % 4 === 0 ? 'Higher Secondary' : i % 3 === 0 ? 'Middle' : 'Primary',
        lowestClass: 'I',
        highestClass: i % 4 === 0 ? 'XII' : i % 3 === 0 ? 'VIII' : 'V',
        headTeacher: `Head Teacher ${i + 1}`,
        mobile: `94350${String(randInt(10000, 99999))}`,
        email: `school${i + 1}.dhubri@assam.gov.in`,
        management: 'Government',
        location: `${blk.name}, Dhubri`,
        assembly: rand(['Dhubri', 'Gauripur', 'Golakganj', 'Bilasipara West']),
        parliament: 'Dhubri',
        bank: {
          accountNumber: String(randInt(30000000000, 39999999999)),
          bankName: bank.bankName,
          ifsc: bank.ifsc,
          branch: blk.name,
        },
        dcOffice: dcOffice._id,
      };
    })
  );
  await DcOffice.findByIdAndUpdate(dcOffice._id, { totalSchools: schools.length });
  for (const blk of blocks) {
    await Block.findByIdAndUpdate(blk._id, {
      totalSchools: schools.filter((s) => String(s.blockRef) === String(blk._id)).length,
    });
  }
  console.log(`[seed] ${schools.length} schools`);

  /* ---------- Users ---------- */
  // create() (not insertMany) so the password-hashing pre-save hook runs.
  const admin = await User.create({
    userId: 'ADMIN001',
    name: 'System Administrator',
    password: 'Admin@123',
    role: ROLES.ADMIN,
    email: 'admin@vidyaposhan.assam.gov.in',
    designation: 'Portal Administrator',
  });

  await User.create({
    userId: 'STATE001',
    name: 'Smti Rupa Deka',
    password: 'State@123',
    role: ROLES.STATE,
    email: 'spd.ssa@assam.gov.in',
    designation: 'State Project Director, Samagra Shiksha Assam',
  });

  const dcUser = await User.create({
    userId: `DC${DISTRICT_ID}`,
    name: 'Sri Pranab Sarma',
    password: 'Dc@123',
    role: ROLES.DC,
    dcOffice: dcOffice._id,
    email: 'billsection.dhubri@assam.gov.in',
    designation: 'Bill Section Officer',
  });

  // One block reviewer per block.
  const blockUsers = [];
  for (const [i, blk] of blocks.entries()) {
    blockUsers.push(
      await User.create({
        userId: `BLK${blk.blockId}`,
        name: `BEEO ${blk.name}`,
        password: 'Block@123',
        role: ROLES.BLOCK,
        block: blk._id,
        email: blk.email,
        designation: 'Block Elementary Education Officer',
      })
    );
  }

  // Each school gets a maker and a checker.
  const makers = [];
  const checkers = [];
  for (const s of schools) {
    makers.push(
      await User.create({
        userId: `MKR${s.code}`,
        name: s.headTeacher,
        password: 'School@123',
        role: ROLES.SCHOOL_MAKER,
        school: s._id,
        email: s.email,
        mobile: s.mobile,
        designation: 'Head Teacher (Maker)',
      })
    );
    checkers.push(
      await User.create({
        userId: `CHK${s.code}`,
        name: `${s.name} Checker`,
        password: 'School@123',
        role: ROLES.SCHOOL_CHECKER,
        school: s._id,
        email: s.email,
        designation: 'Reviewing Authority (Checker)',
      })
    );
  }
  console.log(`[seed] ${3 + blockUsers.length + makers.length + checkers.length} users`);

  /* ---------- Budgets: State → DC → School ---------- */
  const fy = Budget.fyLabel();
  const fundedHeads = categories.slice(0, 5);

  for (const cat of fundedHeads) {
    await Budget.create({
      level: 'dc',
      dcOffice: dcOffice._id,
      financialYear: fy,
      budgetHead: cat.budgetHead,
      allocated: 5000000,
      allocatedBy: admin._id,
      note: `State allocation for ${cat.name}`,
    });
  }

  let schoolBudgets = 0;
  for (const s of schools) {
    for (const cat of fundedHeads) {
      await Budget.create({
        level: 'school',
        school: s._id,
        parentDcOffice: dcOffice._id,
        financialYear: fy,
        budgetHead: cat.budgetHead,
        allocated: 150000,
        allocatedBy: dcUser._id,
        note: `DC allocation for ${cat.name}`,
      });
      schoolBudgets++;
    }
  }
  console.log(`[seed] ${fundedHeads.length} DC + ${schoolBudgets} school budget rows (${fy})`);

  /* ---------- Claims ---------- */
  // Spread across every stage so each role has a populated queue.
  const statusPlan = [
    ...Array(12).fill(CLAIM_STATUS.APPROVED),
    ...Array(6).fill(CLAIM_STATUS.SUBMITTED),
    ...Array(4).fill(CLAIM_STATUS.PENDING_CHECKER),
    ...Array(4).fill(CLAIM_STATUS.PENDING_BLOCK),
    ...Array(3).fill(CLAIM_STATUS.UNDER_QUERY),
    ...Array(2).fill(CLAIM_STATUS.RESUBMITTED),
    ...Array(2).fill(CLAIM_STATUS.RETURNED),
    ...Array(3).fill(CLAIM_STATUS.REJECTED),
    ...Array(2).fill(CLAIM_STATUS.DRAFT),
  ];

  const fyShort = String(
    new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1
  ).slice(-2);

  const claims = [];
  for (const [i, status] of statusPlan.entries()) {
    const idx = i % schools.length;
    const school = schools[idx];
    const maker = makers[idx];
    const checker = checkers[idx];
    const blockUser = blockUsers[idx % blockUsers.length];
    const cat = rand(fundedHeads);
    const vendor = rand(VENDORS);
    const age = randInt(1, 40);

    // The SLA clock only starts once the block forwards it to the DC.
    const atDc = [
      CLAIM_STATUS.SUBMITTED,
      CLAIM_STATUS.UNDER_QUERY,
      CLAIM_STATUS.RESUBMITTED,
      CLAIM_STATUS.APPROVED,
      CLAIM_STATUS.REJECTED,
    ].includes(status);

    const submittedAt = atDc ? daysAgo(age) : null;
    const decided =
      status === CLAIM_STATUS.APPROVED || status === CLAIM_STATUS.REJECTED
        ? daysAgo(Math.max(0, age - randInt(2, 6)))
        : null;

    const claim = {
      claimId: `CLM-AS-${fyShort}-${String(901 + i).padStart(5, '0')}`,
      school: school._id,
      block: school.blockRef,
      dcOffice: dcOffice._id,
      submittedBy: maker._id,

      vendorName: vendor.name,
      vendorGstin: vendor.gstin,
      vendorBankAccount: String(randInt(30000000000, 39999999999)),
      vendorIfsc: vendor.ifsc,
      vendorBankName: vendor.bank,

      category: cat.name,
      budgetHead: cat.budgetHead,

      billNumber: `BILL/${fyShort}/${randInt(100, 999)}`,
      billDate: daysAgo(age + randInt(2, 10)),
      amount: randInt(5, Math.floor((cat.maxAmount || 100000) / 1000)) * 1000,
      description: `${cat.name} expenditure for ${school.name}`,
      attachments: [
        {
          originalName: `bill-${i + 1}.pdf`,
          storedName: `seed-bill-${i + 1}.pdf`,
          path: `seed-bill-${i + 1}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: randInt(80_000, 900_000),
          kind: 'bill',
          uploadedAt: submittedAt || new Date(),
        },
      ],
      status,
      submittedAt,
      decidedAt: decided,
      approvedAt: status === CLAIM_STATUS.APPROVED ? decided : null,
      history: [
        {
          action: AUDIT_ACTIONS.CLAIM_SUBMITTED,
          by: maker.name,
          byUser: maker._id,
          role: ROLES.SCHOOL_MAKER,
          note: 'Sent for checker review',
          at: daysAgo(age + 2),
        },
      ],
    };

    // Everything past the checker carries a checker remark.
    if (status !== CLAIM_STATUS.DRAFT && status !== CLAIM_STATUS.PENDING_CHECKER) {
      claim.checkerRemarks = 'Bill and supporting documents verified at school level.';
      claim.checkedBy = checker._id;
      claim.checkedAt = daysAgo(age + 1);
      claim.history.push({
        action: AUDIT_ACTIONS.CLAIM_FORWARDED,
        by: checker.name,
        byUser: checker._id,
        role: ROLES.SCHOOL_CHECKER,
        note: claim.checkerRemarks,
        at: claim.checkedAt,
      });
    }

    // Everything at the DC also carries a block remark.
    if (atDc) {
      claim.blockRemarks = 'Verified at block level and forwarded to DC office.';
      claim.blockReviewedBy = blockUser._id;
      claim.blockReviewedAt = submittedAt;
      claim.history.push({
        action: AUDIT_ACTIONS.CLAIM_FORWARDED,
        by: blockUser.name,
        byUser: blockUser._id,
        role: ROLES.BLOCK,
        note: claim.blockRemarks,
        at: submittedAt,
      });
    }

    if (status === CLAIM_STATUS.RETURNED) {
      claim.returnReason = 'Vendor bank account number does not match the cancelled cheque.';
      claim.checkerRemarks = claim.returnReason;
      claim.checkedBy = checker._id;
      claim.checkedAt = daysAgo(randInt(1, 4));
      claim.history.push({
        action: AUDIT_ACTIONS.CLAIM_RETURNED,
        by: checker.name,
        byUser: checker._id,
        role: ROLES.SCHOOL_CHECKER,
        note: claim.returnReason,
        at: claim.checkedAt,
      });
    }

    if (status === CLAIM_STATUS.UNDER_QUERY) {
      claim.queryText = 'Vendor GST invoice is illegible. Please re-upload a clear scan.';
      claim.queryRaisedAt = daysAgo(randInt(1, 5));
      claim.history.push({
        action: AUDIT_ACTIONS.CLAIM_QUERIED,
        by: dcUser.name,
        byUser: dcUser._id,
        role: ROLES.DC,
        note: claim.queryText,
        at: claim.queryRaisedAt,
      });
    }

    if (status === CLAIM_STATUS.RESUBMITTED) {
      claim.queryText = 'Measurement book reference missing.';
      claim.queryRaisedAt = daysAgo(randInt(8, 12));
      claim.queryResponse = 'MB reference MB/2024/331 attached as supporting document.';
      claim.queryRespondedAt = daysAgo(randInt(1, 4));
      claim.pausedDays = randInt(3, 7);
    }

    if (status === CLAIM_STATUS.APPROVED) {
      claim.dcRemarks = 'Verified against sanction order. Forwarded for payment.';
      // Roughly half of the approved claims are already paid.
      if (i % 2 === 0) {
        claim.paymentStatus = PAYMENT_STATUS.PAID;
        claim.paidAt = daysAgo(randInt(1, 5));
        claim.paymentRef = `PFMS/${fyShort}/${randInt(10000, 99999)}`;
      }
      claim.history.push({
        action: AUDIT_ACTIONS.CLAIM_APPROVED,
        by: dcUser.name,
        byUser: dcUser._id,
        role: ROLES.DC,
        note: claim.dcRemarks,
        at: decided,
      });
    }

    if (status === CLAIM_STATUS.REJECTED) {
      claim.dcRemarks = 'Expenditure exceeds the sanctioned ceiling for this head.';
      claim.history.push({
        action: AUDIT_ACTIONS.CLAIM_REJECTED,
        by: dcUser.name,
        byUser: dcUser._id,
        role: ROLES.DC,
        note: claim.dcRemarks,
        at: decided,
      });
    }

    if (status === CLAIM_STATUS.DRAFT) {
      claim.history = [
        {
          action: AUDIT_ACTIONS.CLAIM_DRAFTED,
          by: maker.name,
          byUser: maker._id,
          role: ROLES.SCHOOL_MAKER,
          note: 'Saved as draft',
          at: new Date(),
        },
      ];
    }

    claims.push(claim);
  }

  await Claim.insertMany(claims);
  console.log(`[seed] ${claims.length} claims`);

  /* ---------- Notifications for the DC inbox ---------- */
  const pending = await Claim.find({ status: CLAIM_STATUS.SUBMITTED })
    .limit(5)
    .populate('school', 'name');
  await Notification.insertMany(
    pending.map((c) => ({
      recipient: dcUser._id,
      icon: '➡️',
      title: `Claim ${c.claimId} forwarded to your office`,
      body: `${c.school?.name} · ₹${c.amount.toLocaleString('en-IN')}.`,
      claim: c._id,
      claimId: c.claimId,
      channels: ['in_app', 'email'],
    }))
  );

  await AuditLog.create({
    user: admin._id,
    userName: admin.name,
    userId: admin.userId,
    role: admin.role,
    action: AUDIT_ACTIONS.IMPORT,
    detail: `Seed data loaded — ${schools.length} schools, ${blocks.length} blocks, ${claims.length} claims`,
  });

  console.log('\n──────────────────────────────────────────────');
  console.log(' Vidyaposhan seed complete. Logins:');
  console.log('   Admin          → ADMIN001 / Admin@123');
  console.log('   State (SSA)    → STATE001 / State@123');
  console.log(`   DC (district)  → DC${DISTRICT_ID}   / Dc@123`);
  console.log(`   Block          → BLK${blocks[0].blockId} / Block@123`);
  console.log(`   School Maker   → MKR${schools[0].code} / School@123`);
  console.log(`   School Checker → CHK${schools[0].code} / School@123`);
  console.log('──────────────────────────────────────────────\n');

  await disconnectDB();
};

seed().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
