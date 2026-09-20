import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { errorText } from '../api/client.js';
import { Alert, Badge, Card, Empty, PageHead, SearchBox, Spinner, Tile } from '../components/UI.jsx';
import { dateOf, inr, ROLE_LABEL } from '../utils/format.js';
import useDebounced from '../utils/useDebounced.js';

const Row = ({ label, children }) => (
  <div
    style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '9px 0', borderBottom: '1px solid #F3F7FC', gap: 12,
    }}
  >
    <span className="small muted">{label}</span>
    <span style={{ fontWeight: 600, textAlign: 'right' }}>{children}</span>
  </div>
);

/** One school: profile, bank details and its claim history. */
export default function SchoolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useDebounced(q);

  // A new search starts at the first page, or page 3 of the old result shows.
  useEffect(() => { setPage(1); }, [query]);

  const load = useCallback(() => {
    api.get(`/dashboard/school/${id}`, { params: { page, limit: 25, ...(query ? { q: query } : {}) } })
      .then(({ data }) => setData(data))
      .catch((e) => setError(errorText(e)));
  }, [id, page, query]);

  useEffect(load, [load]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;

  const s = data.school;
  const sum = data.summary;
  const payable = Boolean(s.bank?.accountNumber && s.bank?.ifsc);
  const claims = data.claims || data.recent || [];

  /* The whole row opens the bill, keyboard included. */
  const openRow = (c) => {
    const go = () => navigate(`/claims/${c._id}`);
    return {
      className: 'row-open',
      onClick: go,
      role: 'button',
      tabIndex: 0,
      title: `Open ${c.claimId}`,
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      },
    };
  };

  return (
    <>
      <PageHead title={s.name} subtitle={`${s.blockRef?.name || s.block} · ${s.district}`}>
        <button className="btn sm" onClick={() => navigate(-1)}>Back</button>
      </PageHead>

      {!payable && (
        <Alert kind="warn">
          This school has no bank account or IFSC on record. Its approved bills
          cannot be included in the PFMS beneficiary file until that is fixed.
        </Alert>
      )}

      <div className="tiles">
        <Tile label="Total Claims" value={sum.total} sub={inr(sum.totalAmount)} />
        <Tile label="Approved" value={sum.approved} sub={inr(sum.approvedAmount)} tone="green" />
        <Tile label="In Progress" value={sum.pending} tone="amber" />
        <Tile label="Paid Out" value={inr(sum.paidAmount)} tone="purple" />
      </div>

      <div className="school-split">
        <div>
          <Card title="School Profile">
            <Row label="School Code"><code>{s.code}</code></Row>
            <Row label="Block">{s.blockRef?.name || s.block}</Row>
            <Row label="Cluster">{s.cluster || '—'}</Row>
            <Row label="District">{s.district}</Row>
            <Row label="Category">{s.category || '—'}</Row>
            <Row label="Classes">
              {s.lowestClass || '—'} → {s.highestClass || '—'}
            </Row>
            <Row label="Management">{s.management || '—'}</Row>
            <Row label="Assembly">{s.assembly || '—'}</Row>
            <Row label="Parliament">{s.parliament || '—'}</Row>
          </Card>

          <Card title="Contact">
            <Row label="Head Teacher">{s.headTeacher || '—'}</Row>
            <Row label="Mobile">{s.mobile || '—'}</Row>
            <Row label="Email">
              <span className="small">{s.email || '—'}</span>
            </Row>
            <Row label="Location">
              <span className="small">{s.location || '—'}</span>
            </Row>
          </Card>

          {data.logins?.length > 0 && (
            <Card title={`Logins (${data.logins.length})`} padded={false}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>User ID</th><th>Role</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.logins.map((u) => (
                      <tr key={u._id}>
                        <td>
                          <code>{u.userId}</code>
                          <div className="small muted">{u.name}</div>
                        </td>
                        <td className="small">{ROLE_LABEL[u.role] || u.role}</td>
                        <td>
                          <Badge tone={u.isActive ? 'green' : 'red'}>
                            {u.isActive ? 'Active' : 'Disabled'}
                          </Badge>
                          <div className="small muted">
                            {u.lastLoginAt ? dateOf(u.lastLoginAt) : 'Never signed in'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Bank Details">
            <Row label="Bank">{s.bank?.bankName || '—'}</Row>
            <Row label="Account">
              {s.bank?.accountNumber ? <code>{s.bank.accountNumber}</code> : <span className="muted">Not on record</span>}
            </Row>
            <Row label="IFSC">
              {s.bank?.ifsc ? <code>{s.bank.ifsc}</code> : <span className="muted">—</span>}
            </Row>
            <Row label="Branch">{s.bank?.branch || '—'}</Row>
            <Row label="Payment Ready">
              {payable ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}
            </Row>
          </Card>
        </div>

        <div>
          <Card>
            <SearchBox value={q} onSearch={setQ} placeholder="Search this school's bills…" />
          </Card>

          <Card
            title={`Bills · ${data.claimTotal ?? claims.length}`}
            padded={false}
            actions={data.pages > 1 ? (
              <div className="row">
                <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <span className="small muted">{data.page} / {data.pages}</span>
                <button className="btn sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            ) : null}
          >
            {claims.length === 0 ? (
              <Empty>{q ? 'No bill here matches that.' : 'This school has not raised any bills yet.'}</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Claim ID</th><th>Scheme</th><th>Vendor</th>
                      <th className="num">Amount</th><th>Status</th>
                      <th>Payment</th><th>Bill Date</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((c) => (
                      <tr key={c._id} {...openRow(c)}>
                        <td><strong>{c.claimId}</strong></td>
                        <td className="small">{c.category}</td>
                        <td className="small">{c.vendorName || '—'}</td>
                        <td className="num">{inr(c.amount)}</td>
                        <td><Badge>{c.status}</Badge></td>
                        <td>
                          {c.status === 'Approved'
                            ? <Badge>{c.paymentStatus}</Badge>
                            : <span className="muted">—</span>}
                        </td>
                        <td className="small">{dateOf(c.billDate)}</td>
                        <td className="go">open →</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
