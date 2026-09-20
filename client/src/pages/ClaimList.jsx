import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { downloadFile, errorText } from '../api/client.js';
import { Alert, Badge, Card, Empty, SearchBox, Spinner, PageHead } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';
import useOpenRow from '../utils/useOpenRow.js';
import useDebounced from '../utils/useDebounced.js';

const STATUSES = [
  'Draft', 'Pending Checker Review', 'Pending Block Review', 'Submitted',
  'Under Query', 'Resubmitted', 'Returned', 'Approved', 'Rejected',
];

/** Every claim within the caller's scope, with filters and paging. */
export default function ClaimList() {
  const openRow = useOpenRow();
  const [params, setParams] = useSearchParams();
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');

  /*
   * The filters live in the URL, so a link can point at a particular slice —
   * "the rejected bills", say — and land on it. Reading them from state alone
   * meant such a link quietly showed everything instead.
   */
  const filters = {
    status: params.get('status') || '',
    q: params.get('q') || '',
    page: Number(params.get('page')) || 1,
  };

  const set = (patch) => setFilters((f) => ({ ...f, page: 1, ...patch }));

  /*
   * The box types locally and the URL only learns the settled value. Writing
   * every keystroke into the URL made one request per character, and the
   * answers could arrive out of order.
   */
  const [typed, setTyped] = useState(filters.q);
  const settled = useDebounced(typed);
  useEffect(() => {
    if (settled !== filters.q) set({ q: settled });
    // `set` and `filters.q` are derived from the URL, which this updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  const setFilters = (next) => {
    const merged = typeof next === 'function' ? next(filters) : next;
    const clean = {};
    Object.entries(merged).forEach(([k, v]) => {
      if (v !== '' && v != null && !(k === 'page' && Number(v) === 1)) clean[k] = String(v);
    });
    setParams(clean, { replace: true });
  };

  const load = useCallback(() => {
    setRes(null);
    const params = { page: filters.page, limit: 25 };
    if (filters.status) params.status = filters.status;
    if (filters.q) params.q = filters.q;
    api.get('/claims', { params })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));
    // Depend on the values, not the object: `filters` is rebuilt every render,
    // so naming it here would re-fetch forever.
  }, [filters.status, filters.q, filters.page]);

  useEffect(load, [load]);


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
        <SearchBox
          value={typed}
          onSearch={setTyped}
          placeholder="Search claim ID, vendor, bill number or school…"
        >
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </SearchBox>
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
                  <th>Status</th><th>Payment</th><th>Bill Date</th><th></th>
                </tr>
              </thead>
              <tbody>
                {res.claims.map((c) => (
                  <tr key={c._id} {...openRow(`/claims/${c._id}`, `Open ${c.claimId}`)}>
                    <td><strong>{c.claimId}</strong></td>
                    <td>{c.school?.name}</td>
                    <td className="small muted">{c.block?.name || c.school?.block}</td>
                    <td className="small">{c.category}</td>
                    <td className="small">{c.vendorName}</td>
                    <td className="num">{inr(c.amount)}</td>
                    <td><Badge>{c.status}</Badge></td>
                    <td>{c.status === 'Approved' ? <Badge>{c.paymentStatus}</Badge> : <span className="muted">—</span>}</td>
                    <td className="small">{dateOf(c.billDate)}</td>
                    <td className="go">open →</td>
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
