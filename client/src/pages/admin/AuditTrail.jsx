import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorText } from '../../api/client.js';
import { Alert, Badge, Card, Empty, PageHead, SearchBox, Spinner } from '../../components/UI.jsx';
import { dateTimeOf, ROLE_LABEL } from '../../utils/format.js';
import useDebounced from '../../utils/useDebounced.js';

const TONE = {
  'Claim Approved': 'green', 'Claim Rejected': 'red', 'Claim Returned': 'red',
  'Status Changed After Export': 'purple', 'User Transferred': 'purple',
  'Marked Under Query': 'amber', 'Report Exported': 'blue',
};

/** Append-only record of everything that happened. */
export default function AuditTrail() {
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const query = useDebounced(q);

  // A new search starts at the first page, or page 3 of the old result shows.
  useEffect(() => { setPage(1); }, [query]);

  const load = useCallback(() => {
    setRes(null);
    api.get('/users/audit', { params: { page, limit: 50, ...(query ? { q: query } : {}) } })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));
  }, [page, query]);

  useEffect(load, [load]);

  return (
    <>
      <PageHead title="Audit Trail" subtitle="Append-only record of every recorded action." />
      <Alert kind="error">{error}</Alert>

      <Card>
        <SearchBox
          value={q}
          onSearch={setQ}
          placeholder="Search claim ID, person, action or remark…"
        >
          <button className="btn sm" onClick={() =>
            downloadFile('/reports/audit.xlsx').catch((e) => setError(errorText(e)))}>
            Export Excel
          </button>
        </SearchBox>
      </Card>

      <Card
        title={res ? `${res.total} entries` : 'Loading…'}
        padded={false}
        actions={res?.pages > 1 ? (
          <div className="row">
            <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span className="small muted">{res.page} / {res.pages}</span>
            <button className="btn sm" disabled={page >= res.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        ) : null}
      >
        {!res ? <Spinner /> : res.logs.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Action</th><th>By</th><th>Role</th><th>Claim</th><th>Detail</th></tr></thead>
              <tbody>
                {res.logs.map((l) => (
                  <tr key={l._id}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{dateTimeOf(l.createdAt)}</td>
                    <td><Badge tone={TONE[l.action] || 'grey'}>{l.action}</Badge></td>
                    <td className="small">{l.userName}</td>
                    <td className="small muted">{ROLE_LABEL[l.role] || l.role}</td>
                    <td className="small">
                      {l.claimId
                        ? <Link to={`/claims/${l.claimId}`}><code>{l.claimId}</code></Link>
                        : '—'}
                    </td>
                    <td className="small" style={{ maxWidth: 380 }}>{l.detail}</td>
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
