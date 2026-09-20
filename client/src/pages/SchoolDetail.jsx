import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorText } from '../api/client.js';
import { Alert, Badge, Card, Empty, PageHead, Spinner, Tile } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';

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

  useEffect(() => {
    api.get(`/dashboard/school/${id}`)
      .then(({ data }) => setData(data))
      .catch((e) => setError(errorText(e)));
  }, [id]);

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;

  const s = data.school;
  const sum = data.summary;
  const payable = Boolean(s.bank?.accountNumber && s.bank?.ifsc);

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18, alignItems: 'start' }}>
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

        <Card title={`Recent Claims (${data.recent.length})`} padded={false}>
          {data.recent.length === 0 ? (
            <Empty>This school has not raised any bills yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Claim ID</th><th>Scheme</th>
                    <th className="num">Amount</th><th>Status</th>
                    <th>Payment</th><th>Bill Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <Link to={`/claims/${c._id}`}><strong>{c.claimId}</strong></Link>
                      </td>
                      <td className="small">{c.category}</td>
                      <td className="num">{inr(c.amount)}</td>
                      <td><Badge>{c.status}</Badge></td>
                      <td>
                        {c.status === 'Approved'
                          ? <Badge>{c.paymentStatus}</Badge>
                          : <span className="muted">—</span>}
                      </td>
                      <td className="small">{dateOf(c.billDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
