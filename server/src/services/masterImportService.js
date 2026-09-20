import School from '../models/School.js';
import Block from '../models/Block.js';
import DcOffice from '../models/DcOffice.js';

/**
 * Parses the SSA school master sheet and builds the District → Block → School
 * hierarchy from the government ids the sheet already carries.
 *
 * The admin never invents ids: district_id, block_id and school_code are the
 * source of truth, so re-uploading an updated sheet updates in place.
 */

/** Master column → our field. Several spellings are accepted per field. */
export const COLUMN_MAP = {
  slNo: ['sl no.', 'sl no', 'sl. no.', 'slno', 's.no', 'sr no'],
  districtName: ['district_name', 'district name', 'district'],
  districtId: ['district_id', 'district id', 'districtid'],
  blockName: ['block_name', 'block name', 'block'],
  blockId: ['block_id', 'block id', 'blockid'],
  clusterName: ['cluster_name', 'cluster name', 'cluster'],
  clusterId: ['cluster_id', 'cluster id', 'clusterid'],
  schoolCode: ['school_code', 'school code', 'udise', 'udise_code', 'udise code'],
  schoolName: ['school_name', 'school name'],
  lowestClass: ['lowest_class', 'lowest class', 'lowest_cl ass', 'lowestclass'],
  highestClass: ['highest_class', 'highest class', 'highest class', 'highestclass'],
  category: ['school_assam_category', 'school_category', 'category', 'school assam category'],
  management: ['school_management', 'school management', 'management'],
  contactName: ['contact_name', 'contact name', 'head teacher', 'headteacher', 'hm name'],
  contactNumber: ['contact_number', 'contact number', 'contact_nu mber', 'mobile', 'phone'],
  email: ['email_id', 'email id', 'email', 'e-mail'],
  location: ['location', 'address', 'village'],
  assembly: ['assembly_name', 'assembly name', 'assembly', 'ac_name'],
  parliament: ['parliament_name', 'parliament name', 'parliament', 'pc_name'],
  accountNumber: ['bank_account_number', 'bank account number', 'account_number', 'account no', 'a/c no'],
  bankName: ['bank_name', 'bank name', 'bank'],
  branch: ['bank_branch', 'bank branch', 'branch'],
  ifsc: ['bank_ifsc_code', 'bank ifsc code', 'ifsc', 'ifsc_code', 'ifsc code'],
  gstin: ['gstin', 'gst', 'gstin_no', 'gst no'],
};

/** Columns a row cannot be imported without. */
export const REQUIRED = ['districtId', 'districtName', 'blockId', 'blockName', 'schoolCode', 'schoolName'];

/** Column name -> the field it lands in on a parsed record. */
const RECORD_FIELD = {
  districtId: 'districtId',
  districtName: 'district',
  blockId: 'blockId',
  blockName: 'block',
  schoolCode: 'code',
  schoolName: 'name',
};

const norm = (h) => String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Maps the sheet's header row onto our field names.
 * Returns { resolved: {field: header}, missing: [field], unknown: [header] }.
 */
export const resolveHeaders = (headers = []) => {
  const seen = headers.map((h) => ({ raw: h, key: norm(h) }));
  const resolved = {};
  const usedHeaders = new Set();

  for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
    const hit = seen.find((s) => aliases.includes(s.key) && !usedHeaders.has(s.raw));
    if (hit) {
      resolved[field] = hit.raw;
      usedHeaders.add(hit.raw);
    }
  }

  return {
    resolved,
    missing: REQUIRED.filter((f) => !resolved[f]),
    unknown: seen.filter((s) => s.key && !usedHeaders.has(s.raw)).map((s) => s.raw),
  };
};

const cell = (row, header) => {
  if (!header) return '';
  const v = row[header];
  if (v === null || v === undefined) return '';
  // ExcelJS may hand back a rich-text or formula object.
  if (typeof v === 'object') return String(v.text ?? v.result ?? '').trim();
  return String(v).trim();
};

/** Ids arrive as numbers, sometimes with a trailing ".0" from Excel. */
const idOf = (v) => String(v ?? '').trim().replace(/\.0+$/, '');

const digitsOnly = (v) => String(v ?? '').replace(/[^\d]/g, '');

/**
 * Reads parsed workbook rows into clean records, without touching the database.
 * `dryRun` callers use exactly this to preview an upload.
 */
export const analyseRows = (rows, headerMap) => {
  const records = [];
  const skipped = [];

  const districts = new Map();
  const blocks = new Map();
  const seenCodes = new Set();

  rows.forEach((row, i) => {
    const rowNo = i + 2; // sheet row, accounting for the header

    const rec = {
      districtId: idOf(cell(row, headerMap.districtId)),
      district: cell(row, headerMap.districtName),
      blockId: idOf(cell(row, headerMap.blockId)),
      block: cell(row, headerMap.blockName),
      clusterId: idOf(cell(row, headerMap.clusterId)),
      cluster: cell(row, headerMap.clusterName),
      code: idOf(cell(row, headerMap.schoolCode)),
      name: cell(row, headerMap.schoolName),
      lowestClass: cell(row, headerMap.lowestClass),
      highestClass: cell(row, headerMap.highestClass),
      category: cell(row, headerMap.category),
      management: cell(row, headerMap.management),
      headTeacher: cell(row, headerMap.contactName),
      mobile: digitsOnly(cell(row, headerMap.contactNumber)).slice(0, 10),
      email: cell(row, headerMap.email).toLowerCase(),
      location: cell(row, headerMap.location),
      assembly: cell(row, headerMap.assembly),
      parliament: cell(row, headerMap.parliament),
      gstin: cell(row, headerMap.gstin).toUpperCase(),
      bank: {
        accountNumber: digitsOnly(cell(row, headerMap.accountNumber)),
        bankName: cell(row, headerMap.bankName),
        branch: cell(row, headerMap.branch),
        ifsc: cell(row, headerMap.ifsc).toUpperCase(),
      },
    };

    // Ignore blank filler rows rather than reporting them as errors.
    const hasAnything = Object.values(rec).some((v) =>
      typeof v === 'string' ? v !== '' : Object.values(v).some(Boolean)
    );
    if (!hasAnything) return;

    const missing = REQUIRED.filter((f) => !rec[RECORD_FIELD[f]]);
    if (missing.length) {
      skipped.push({ row: rowNo, school: rec.name || rec.code || '(blank)', reason: `Missing: ${missing.join(', ')}` });
      return;
    }

    if (seenCodes.has(rec.code)) {
      skipped.push({ row: rowNo, school: rec.name, reason: `Duplicate school_code ${rec.code} in this file` });
      return;
    }
    seenCodes.add(rec.code);

    if (!districts.has(rec.districtId)) {
      districts.set(rec.districtId, { districtId: rec.districtId, name: rec.district, blocks: new Set(), schools: 0 });
    }
    const d = districts.get(rec.districtId);
    d.blocks.add(rec.blockId);
    d.schools++;

    if (!blocks.has(rec.blockId)) {
      blocks.set(rec.blockId, {
        blockId: rec.blockId, name: rec.block,
        districtId: rec.districtId, district: rec.district, schools: 0,
      });
    }
    blocks.get(rec.blockId).schools++;

    records.push({ ...rec, _row: rowNo });
  });

  // Data-quality signals the admin should see before committing.
  const noBank = records.filter((r) => !r.bank.accountNumber || !r.bank.ifsc);
  const badIfsc = records.filter(
    (r) => r.bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(r.bank.ifsc)
  );

  return {
    records,
    skipped,
    districts: [...districts.values()].map((d) => ({ ...d, blocks: d.blocks.size })),
    blocks: [...blocks.values()],
    warnings: {
      missingBank: noBank.map((r) => ({ code: r.code, school: r.name })),
      invalidIfsc: badIfsc.map((r) => ({ code: r.code, school: r.name, ifsc: r.bank.ifsc })),
    },
  };
};

/**
 * Writes the analysed records into the database, creating the district and
 * block rows first so every school can be linked to both.
 */
export const commitImport = async (analysis) => {
  const { records, districts, blocks } = analysis;

  const dcByDistrictId = new Map();
  let dcCreated = 0;
  let dcUpdated = 0;

  for (const d of districts) {
    const existing = await DcOffice.findOne({ districtId: d.districtId });
    if (existing) {
      existing.name = existing.name || `Office of the Deputy Commissioner, ${d.name}`;
      existing.district = d.name;
      await existing.save();
      dcByDistrictId.set(d.districtId, existing._id);
      dcUpdated++;
    } else {
      const created = await DcOffice.create({
        districtId: d.districtId,
        code: `DC-${d.districtId}`,
        name: `Office of the Deputy Commissioner, ${d.name}`,
        district: d.name,
      });
      dcByDistrictId.set(d.districtId, created._id);
      dcCreated++;
    }
  }

  const blockByBlockId = new Map();
  let blkCreated = 0;
  let blkUpdated = 0;

  for (const b of blocks) {
    const dcId = dcByDistrictId.get(b.districtId);
    const existing = await Block.findOne({ blockId: b.blockId });
    if (existing) {
      existing.name = b.name;
      existing.district = b.district;
      existing.districtId = b.districtId;
      existing.dcOffice = dcId;
      await existing.save();
      blockByBlockId.set(b.blockId, existing._id);
      blkUpdated++;
    } else {
      const created = await Block.create({
        blockId: b.blockId,
        code: `BLK-${b.blockId}`,
        name: b.name,
        districtId: b.districtId,
        district: b.district,
        dcOffice: dcId,
      });
      blockByBlockId.set(b.blockId, created._id);
      blkCreated++;
    }
  }

  let inserted = 0;
  let updated = 0;
  const failed = [];

  for (const r of records) {
    const { _row, ...doc } = r;
    doc.blockRef = blockByBlockId.get(r.blockId);
    doc.dcOffice = dcByDistrictId.get(r.districtId);

    try {
      const existing = await School.findOne({ code: r.code });
      if (existing) {
        Object.assign(existing, doc);
        await existing.save();
        updated++;
      } else {
        await School.create(doc);
        inserted++;
      }
    } catch (err) {
      failed.push({ row: _row, school: r.name, reason: err.message });
    }
  }

  // Keep the denormalised counters honest.
  for (const [blockId, _id] of blockByBlockId) {
    await Block.findByIdAndUpdate(_id, { totalSchools: await School.countDocuments({ blockRef: _id }) });
  }
  for (const [districtId, _id] of dcByDistrictId) {
    await DcOffice.findByIdAndUpdate(_id, {
      totalSchools: await School.countDocuments({ dcOffice: _id }),
      totalBlocks: await Block.countDocuments({ dcOffice: _id }),
    });
  }

  return {
    districts: { created: dcCreated, updated: dcUpdated },
    blocks: { created: blkCreated, updated: blkUpdated },
    schools: { inserted, updated, failed },
  };
};
