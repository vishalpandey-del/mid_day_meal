import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errorText } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Card, Confirm, Empty, Spinner } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';

/**
 * The signed-in user's own action queue. For the DC this doubles as the
 * bulk-approval screen: tick several bills and clear them in one go.
 */
export default function MyQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDc = user?.role === 'dc';

  const [claims, setClaims] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [remarks, setRemarks] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setClaims(null);
    api.get('/dashboard/queue')
      .then(({ data }) => { setClaims(data.claims); setPicked(new Set()); })
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(load, [load]);

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allPicked = claims?.length > 0 && picked.size === claims.length;
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(claims.map((c) => c._id)));

  const pickedTotal = (claims || [])
    .filter((c) => picked.has(c._id))
    .reduce((s, c) => s + c.amount, 0);

  const bulkApprove = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/claims/bulk-approve', {
        claimIds: [...picked],
        remarks,
      });
      setNote(
        `${data.approvedCount} bill(s) approved · ${inr(data.totalAmount)}` +
        (data.failedCount ? ` · ${data.failedCount} could not be approved` : '')
      );
      setConfirming(false);
      setRemarks('');
      load();
    } catch (e) {
      setError(errorText(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (error && !claims) return <Alert kind="error">{error}</Alert>;
  if (!claims) return <Spinner />;

  return (
    <>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{note}</Alert>

      <Card
        title={`My Queue · ${claims.length} claim(s)`}
        actions={
          isDc && picked.size > 0 ? (
            <div className="row">
              <span className="small muted">{picked.size} selected · {inr(pickedTotal)}</span>
              <button className="btn green sm" onClick={() => setConfirming(true)}>
                Approve Selected
              </button>
            </div>
          ) : null
        }
        padded={false}
      >
        {claims.length === 0 ? (
          <Empty>Nothing is waiting for you right now.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isDc && (
                    <th style={{ width: 34 }}>
                      <input type="checkbox" checked={allPicked} onChange={toggleAll} />
                    </th>
                  )}
                  <th>Claim ID</th>
                  <th>School</th>
                  <th>Scheme</th>
                  <th>Vendor</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  {isDc && <th className="num">Age</th>}
                  <th>Bill Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c._id}>
                    {isDc && (
                      <td>
                        <input
                          type="checkbox"
                          checked={picked.has(c._id)}
                          onChange={() => toggle(c._id)}
                        />
                      </td>
                    )}
                    <td><Link to={`/claims/${c._id}`}><strong>{c.claimId}</strong></Link></td>
                    <td>{c.school?.name}</td>
                    <td className="small">{c.category}</td>
                    <td className="small">{c.vendorName}</td>
                    <td className="num">{inr(c.amount)}</td>
                    <td><Badge>{c.status}</Badge></td>
                    {isDc && (
                      <td className="num">
                        <Badge tone={c.slaBucket === 'breached' ? 'red' : c.slaBucket === 'reminder' ? 'amber' : 'green'}>
                          {c.ageDays}d
                        </Badge>
                      </td>
                    )}
                    <td className="small">{dateOf(c.billDate)}</td>
                    <td>
                      <button className="btn sm" onClick={() => navigate(`/claims/${c._id}`)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Confirm
        open={confirming}
        title={`Approve ${picked.size} bill(s)?`}
        onCancel={() => setConfirming(false)}
        onConfirm={bulkApprove}
        confirmLabel="Approve All"
        busy={busy}
      >
        <p className="small">
          Total value <strong>{inr(pickedTotal)}</strong>. Each bill is checked
          individually — any that cannot be approved will be listed back to you.
        </p>
        <div className="field">
          <label>Remarks (applied to every selected bill)</label>
          <textarea
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. Verified against sanction order"
          />
        </div>
      </Confirm>
    </>
  );
}
