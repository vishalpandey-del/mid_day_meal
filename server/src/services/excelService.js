import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1929' } };
const TITLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5E9' } };

const autoWidth = (sheet, headers, rows) => {
  sheet.columns.forEach((col, i) => {
    const header = String(headers[i] ?? '');
    const longest = rows.reduce(
      (max, r) => Math.max(max, String(r[i] ?? '').length),
      header.length
    );
    col.width = Math.min(Math.max(longest + 4, 12), 48);
  });
};

/**
 * Standard report sheet: dark header row, frozen pane, auto filter.
 *
 * Every sheet this produces is called "Sheet1". Downstream tools — PFMS
 * among them — look the sheet up by that name, so it is fixed here rather
 * than left to each caller to remember.
 */
export const SHEET_NAME = 'Sheet1';

export const buildWorkbook = ({ headers, rows, title }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vidyaposhan · SSA Assam';
  wb.created = new Date();
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', ySplit: title ? 2 : 1 }],
  });

  if (title) {
    ws.addRow([title]);
    ws.mergeCells(1, 1, 1, headers.length);
    const t = ws.getRow(1);
    t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    t.height = 24;
    t.eachCell((c) => { c.fill = TITLE_FILL; });
  }

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 20;
  headerRow.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });

  rows.forEach((r) => ws.addRow(r));

  ws.autoFilter = {
    from: { row: title ? 2 : 1, column: 1 },
    to: { row: title ? 2 : 1, column: headers.length },
  };
  autoWidth(ws, headers, rows);
  return wb;
};

/**
 * PFMS "Add Beneficiary Details" file.
 *
 * The beneficiary is ALWAYS the school — bank details come from the school
 * master — and a school is paid once per scheme, not once per bill. Five Mid
 * Day Meal bills for one school are one transfer into one account against one
 * budget head, so they are one line here, with every claim id named in the
 * remark so the transfer can be traced back to the bills it settles. A second
 * scheme for the same school is a separate line: different budget head,
 * different money.
 */
export const buildBeneficiaryWorkbook = (claims) => {
  const headers = [
    'SI.No', 'Beneficiary Name', 'Account Number', 'Bank Name',
    'IFSC Code', 'GSTIN No', 'Amount (In Lakhs)', 'Remarks',
  ];

  const merged = [...claims.reduce((map, c) => {
    const school = c.school || {};
    const key = `${String(school._id || c.school)}::${c.category}`;
    const line = map.get(key) || {
      school,
      category: c.category,
      budgetHead: c.budgetHead,
      amount: 0,
      claimIds: [],
    };
    line.amount += c.amount;
    line.claimIds.push(c.claimId);
    map.set(key, line);
    return map;
  }, new Map()).values()];

  const rows = merged.map((line, i) => {
    const s = line.school;
    const bank = s.bank || {};
    return [
      i + 1,
      s.name || '',
      bank.accountNumber || '',
      bank.bankName || '',
      bank.ifsc || '',
      s.gstin || '',
      Number((line.amount / 100000).toFixed(5)),
      // The remark carries the trail: which scheme, and every bill in it.
      `${line.category}${line.budgetHead ? ` (${line.budgetHead})` : ''} | ` +
      `${line.claimIds.length} bill(s) | ${line.claimIds.join(', ')}`,
    ];
  });

  const wb = buildWorkbook({
    headers,
    rows,
    title: 'Add Beneficiary Details',
  });

  const ws = wb.getWorksheet(SHEET_NAME);
  // Amount column formatted to 5 decimals, as PFMS expects lakh values.
  ws.getColumn(7).numFmt = '0.00000';
  ws.getColumn(7).alignment = { horizontal: 'right' };

  // No total row: PFMS reads every row after the header as a beneficiary, and
  // a trailing "TOTAL" line is one more record to it, with no account number.
  return wb;
};

export const sendWorkbook = async (res, wb, filename) => {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  await wb.xlsx.write(res);
  res.end();
};

/** Reads an uploaded workbook into an array of row objects keyed by header. */
export const parseWorkbook = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const headers = (ws.getRow(1).values || []).slice(1).map((h) => String(h ?? '').trim());
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const values = (row.values || []).slice(1);
    if (!values.some((v) => v !== null && v !== undefined && String(v).trim() !== '')) return;
    const obj = {};
    headers.forEach((h, i) => {
      const v = values[i];
      obj[h] = v && typeof v === 'object' && 'text' in v ? v.text : v ?? '';
    });
    rows.push(obj);
  });
  return { headers, rows };
};
