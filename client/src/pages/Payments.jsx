import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorText } from '../api/client.js';
import { Alert, Badge, Card, Confirm, Empty, PageHead, SearchBox, Spinner, Tile } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';
import useDebounced from '../utils/useDebounced.js';

/**
 * The DC payment desk. Bills sit in one of three states:
 *   Unpaid            — approved, never paid out
 *   Paid              — settled
 *   Payment Reversed  — money went out and came back; must be paid again
 */
const TABS = [
  { key: 'Unpaid', label: 'Awaiting Payment', tone: 'amber' },
  { key: 'Paid', label: 'Paid', tone: 'green' },
  { key: 'Payment Reversed', label: 'Payment Reversed', tone: 'red' },
];

export default function Payments() {
  const [tab, setTab] = useState('Unpaid');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [res, setRes] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  // Reversal needs a written reason, so it goes through a confirm step.
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    setRes(null);
    api.get('/claims', { params: { status: 'Approved', paymentStatus: tab, q: query || undefined, limit: 100 } })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));

    // Tab counts, so the desk shows its whole workload at a glance.
    Promise.all(
      TABS.map((t) =>
        api.get('/claims', { params: { status: 'Approved', paymentStatus: t.key, limit: 1 } })
          .then(({ data }) => [t.key, data.total])
          .catch(() => [t.key, 0])
      )
    ).then((rows) => setCounts(Object.fromEntries(rows)));
  }, [tab, query]);

  useEffect(load, [load]);

  const setPayment = async (c, paymentStatus, remarks = '') => {
    setBusy(c._id);
    setError('');
    try {
      await api.patch(`/claims/${c._id}/payment`, { paymentStatus, remarks });
      setNote(`${c.claimId} → ${paymentStatus}.`);
      setReversing(null);
      setReason('');
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const total = (res?.claims || []).reduce((s, c) => s + c.amount, 0);
  const active = TABS.find((t) => t.key === tab);

  return (
    <>
      <PageHead
        title="Payments"
        subtitle="Approved bills and where each one stands with the treasury."
      >
        <button
          className="btn primary sm"
          onClick={() =>
            /* The file follows the tab, so each one exports what it shows. */
            downloadFile('/reports/beneficiary.xlsx', { paymentStatus: tab })
              .then((n) => setNote(`Downloaded ${n} — the ${active.label.toLowerCase()} bills.`))
              .then(load)
              .catch((e) => setError(errorText(e)))
          }
        >
          Download PFMS File
        </button>
      </PageHead>

      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{note}</Alert>

      <div className="tiles">
        {TABS.map((t) => (
          <Tile
            key={t.key}
            label={t.label}
            value={counts[t.key] ?? '—'}
            tone={t.tone}
            sub={t.key === tab ? inr(total) : undefined}
          />
        ))}
      </div>

      {counts['Payment Reversed'] > 0 && tab !== 'Payment Reversed' && (
        <Alert kind="warn">
          <strong>{counts['Payment Reversed']} bill(s)</strong> came back from the treasury and
          still need paying.{' '}
          <button
            className="btn sm"
            style={{ marginLeft: 6 }}
            onClick={() => setTab('Payment Reversed')}
          >
            Open them →
          </button>
        </Alert>
      )}

      <Card>
        <SearchBox
          value={q}
          onSearch={setQ}
          placeholder="Search bill number, vendor or school…"
        />
      </Card>

      <div className="pill-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label} {counts[t.key] != null ? `(${counts[t.key]})` : ''}
          </button>
        ))}
      </div>

      <Card title={`${active.label} · ${res?.total ?? '…'}`} padded={false}>
        {!res ? (
          <Spinner />
        ) : res.claims.length === 0 ? (
          <Empty>
            {tab === 'Payment Reversed'
              ? 'No reversed payments — everything that went out stayed out.'
              : `No ${active.label.toLowerCase()} bills.`}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Claim ID</th><th>School</th><th>Account</th>
                  <th className="num">Amount</th>
                  <th>{tab === 'Payment Reversed' ? 'Reversed On' : 'Approved'}</th>
                  {tab === 'Payment Reversed' && <th>Reason</th>}
                  <th>Exported</th><th></th>
                </tr>
              </thead>
              <tbody>
                {res.claims.map((c) => (
                  <tr key={c._id}>
                    <td>
                      <Link to={`/claims/${c._id}`}><strong>{c.claimId}</strong></Link>
                      {c.reversalCount > 0 && (
                        <div className="small" style={{ color: 'var(--rose-d)' }}>
                          reversed {c.reversalCount}×
                        </div>
                      )}
                    </td>
                    <td>{c.school?.name}</td>
                    <td className="small">
                      {c.school?.bank?.accountNumber
                        ? <code>{c.school.bank.accountNumber}</code>
                        : <Badge tone="red">No bank details</Badge>}
                    </td>
                    <td className="num">{inr(c.amount)}</td>
                    <td className="small">
                      {dateOf(tab === 'Payment Reversed' ? c.reversedAt : c.approvedAt)}
                    </td>
                    {tab === 'Payment Reversed' && (
                      <td className="small" style={{ maxWidth: 240 }}>{c.reversalReason}</td>
                    )}
                    <td className="small">
                      {c.lastExportedAt
                        ? <Badge tone="blue">{dateOf(c.lastExportedAt)}</Badge>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="row">
                        {tab === 'Unpaid' && (
                          <button className="btn green sm" disabled={busy === c._id}
                                  onClick={() => setPayment(c, 'Paid')}>
                            {busy === c._id ? '…' : 'Mark Paid'}
                          </button>
                        )}
                        {tab === 'Paid' && (
                          <>
                            <button className="btn red sm" disabled={busy === c._id}
                                    onClick={() => { setReversing(c); setReason(''); }}>
                              Mark Reversed
                            </button>
                            <button className="btn sm" disabled={busy === c._id}
                                    onClick={() => setPayment(c, 'Unpaid')}>
                              Undo
                            </button>
                          </>
                        )}
                        {tab === 'Payment Reversed' && (
                          <button className="btn green sm" disabled={busy === c._id}
                                  onClick={() => setPayment(c, 'Paid', 'Re-paid after reversal')}>
                            {busy === c._id ? '…' : 'Pay Again'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Confirm
        open={Boolean(reversing)}
        title={`Reverse payment for ${reversing?.claimId || ''}?`}
        onCancel={() => setReversing(null)}
        onConfirm={() => setPayment(reversing, 'Payment Reversed', reason)}
        confirmLabel="Mark Reversed"
        busy={busy === reversing?._id}
      >
        <p className="small">
          The bill moves to <strong>Payment Reversed</strong> and comes back into the
          PFMS file, so it gets paid again. The school is notified.
        </p>
        <div className="field">
          <label>Why did the payment come back? *</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Account closed at the bank · IFSC no longer valid · Treasury rejected the batch"
          />
          <div className="hint">At least 5 characters. This is recorded in the audit trail.</div>
        </div>
      </Confirm>
    </>
  );
}
