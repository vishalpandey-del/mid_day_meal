import { useCallback, useEffect, useState } from 'react';
import api, { downloadFile, errorText } from '../../api/client.js';
import { Alert, Badge, Card, Empty, PageHead, Spinner } from '../../components/UI.jsx';
import { dateTimeOf, ROLE_LABEL } from '../../utils/format.js';

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
  const [claimId, setClaimId] = useState('');

  const load = useCallback(() => {
    setRes(null);
    api.get('/users/audit', { params: { page, limit: 50, ...(claimId ? { claimId } : {}) } })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));
  }, [page, claimId]);

  useEffect(load, [load]);

  return (
    <>
      <PageHead title="Audit Trail" subtitle="Append-only record of every recorded action." />
      <Alert kind="error">{error}</Alert>

      <Card>
        <div className="row">
          <input
            placeholder="Filter by claim ID, e.g. CLM-AS-26-00901"
            style={{ flex: 1, minWidth: 240, padding: '7px 10px', border: '1px solid var(--border-strong)', borderRadius: 3 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setClaimId(e.target.value.trim()); setPage(1); } }}
          />
          {claimId && <button className="btn sm" onClick={() => { setClaimId(''); setPage(1); }}>Clear</button>}
          <button className="btn sm" onClick={() =>
            downloadFile('/reports/audit.xlsx').catch((e) => setError(errorText(e)))}>
            Export Excel
          </button>
        </div>
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
                    <td className="small">{l.claimId ? <code>{l.claimId}</code> : '—'}</td>
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
