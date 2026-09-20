export const inr = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const toLakhs = (n) => Number((Number(n || 0) / 100000).toFixed(5));

export const todayStamp = () => new Date().toISOString().slice(0, 10);

export const maskAccount = (acc = '') =>
  acc && acc.length > 4 ? `••••${acc.slice(-4)}` : acc;

/** Working-day difference, skipping Saturdays and Sundays. */
export const workingDaysBetween = (from, to = new Date()) => {
  if (!from) return 0;
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
  }
  return count;
};
