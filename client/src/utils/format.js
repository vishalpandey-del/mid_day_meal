export const inr = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const inrFull = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const lakhs = (n) => (Number(n || 0) / 100000).toFixed(2) + ' L';

export const dateOf = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const dateTimeOf = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Colour token per claim status, used by the badge component. */
export const STATUS_TONE = {
  Draft: 'grey',
  'Pending Checker Review': 'amber',
  'Pending Block Review': 'amber',
  Submitted: 'blue',
  'Under Query': 'purple',
  Resubmitted: 'blue',
  Returned: 'red',
  Approved: 'green',
  Rejected: 'red',
  Closed: 'grey',
  Paid: 'green',
  Unpaid: 'amber',
};

export const ROLE_LABEL = {
  school_maker: 'School (Maker)',
  school_checker: 'School (Checker)',
  block: 'Block Office',
  dc: 'District Control',
  state: 'State / SSA',
  admin: 'Administrator',
};
