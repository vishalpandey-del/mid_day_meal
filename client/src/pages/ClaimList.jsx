import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorText } from '../api/client.js';
import { Alert, Badge, Card, Empty, Spinner, PageHead } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';

const STATUSES = [
  'Draft', 'Pending Checker Review', 'Pending Block Review', 'Submitted',
  'Under Query', 'Resubmitted', 'Returned', 'Approved', 'Rejected',
];

/** Every claim within the caller's scope, with filters and paging. */
export default function ClaimList() {
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', q: '', page: 1 });

  const load = useCallback(() => {
    setRes(null);
    const params = { page: filters.page, limit: 25 };
    if (filters.status) params.status = filters.status;
    if (filters.q) params.q = filters.q;
    api.get('/claims', { params })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));
  }, [filters]);

  useEffect(load, [load]);

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  return (
    <>
      <PageHead title="All Claims" subtitle="Every bill within your scope.">
        <button className="btn sm" onClick={() => downloadFile('/reports/claims.xlsx', {
          ...(filters.status ? { status: filters.status } : {}),
        }).catch((e) => setError(errorText(e)))}>
          Export Excel
        </button>
      </PageHead>
      <Alert kind="error">{error}</Alert>

      <Card>
        <div className="row">
          <input
            placeholder="Search claim ID, vendor or bill number…"
            style={{ flex: 1, minWidth: 220, padding: '7px 10px', border: '1px solid var(--border-strong)', borderRadius: 3 }}
            defaultValue={filters.q}
            onKeyDown={(e) => { if (e.key === 'Enter') set({ q: e.target.value }); }}
          />
          <select
            value={filters.status}
            onChange={(e) => set({ status: e.target.value })}
            style={{ padding: '7px 10px', border: '1px solid var(--border-strong)', borderRadius: 3 }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {(filters.status || filters.q) && (
            <button className="btn sm" onClick={() => setFilters({ status: '', q: '', page: 1 })}>
              Clear
            </button>
          )}
        </div>
      </Card>

      <Card
        title={res ? `${res.total} claim(s)` : 'Loading…'}
        padded={false}
        actions={res?.pages > 1 ? (
          <div className="row">
            <button className="btn sm" disabled={filters.page <= 1}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Prev</button>
            <span className="small muted">Page {res.page} / {res.pages}</span>
            <button className="btn sm" disabled={filters.page >= res.pages}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</button>
          </div>
        ) : null}
      >
        {!res ? <Spinner /> : res.claims.length === 0 ? (
          <Empty>No claims match this filter.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Claim ID</th><th>School</th><th>Block</th><th>Scheme</th>
                  <th>Vendor</th><th className="num">Amount</th>
                  <th>Status</th><th>Payment</th><th>Bill Date</th>
                </tr>
              </thead>
              <tbody>
                {res.claims.map((c) => (
                  <tr key={c._id}>
                    <td><Link to={`/claims/${c._id}`}><strong>{c.claimId}</strong></Link></td>
                    <td>{c.school?.name}</td>
                    <td className="small muted">{c.block?.name || c.school?.block}</td>
                    <td className="small">{c.category}</td>
                    <td className="small">{c.vendorName}</td>
                    <td className="num">{inr(c.amount)}</td>
                    <td><Badge>{c.status}</Badge></td>
                    <td>{c.status === 'Approved' ? <Badge>{c.paymentStatus}</Badge> : <span className="muted">—</span>}</td>
                    <td className="small">{dateOf(c.billDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
