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
 * The beneficiary is ALWAYS the school — bank details come from the school master.
 */
export const buildBeneficiaryWorkbook = (claims) => {
  const headers = [
    'SI.No', 'Beneficiary Name', 'Account Number', 'Bank Name',
    'IFSC Code', 'GSTIN No', 'Amount (In Lakhs)', 'Remarks',
  ];

  const rows = claims.map((c, i) => {
    const s = c.school || {};
    const bank = s.bank || {};
    return [
      i + 1,
      s.name || '',
      bank.accountNumber || '',
      bank.bankName || '',
      bank.ifsc || '',
      s.gstin || '',
      Number((c.amount / 100000).toFixed(5)),
      `${c.claimId} | ${s.name || ''} | ${c.status}`,
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

  const total = rows.reduce((s, r) => s + Number(r[6] || 0), 0);
  const totalRow = ws.addRow(['', '', '', '', '', 'TOTAL', Number(total.toFixed(5)), '']);
  totalRow.font = { bold: true };
  totalRow.getCell(7).numFmt = '0.00000';

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
