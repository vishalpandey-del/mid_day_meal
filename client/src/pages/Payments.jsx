import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorText } from '../api/client.js';
import { Alert, Badge, Card, Confirm, Empty, PageHead, SearchBox, Spinner, Tile } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';
import useDebounced from '../utils/useDebounced.js';
import useOpenRow from '../utils/useOpenRow.js';

/**
 * The DC payment desk. A bill goes round it, and every lap sends a file.
 *
 *   Awaiting Payment  approved, and the treasury has not been told to pay
 *   Paid              marked paid here, and the treasury has not been told yet
 *   Downloaded        in a file — the treasury has the latest word on it
 *   Payment Reversed  the money came back, or a payment was downloaded and
 *                     can still be taken back if it was marked in error
 *
 * Two of these are work: Awaiting and Paid both have something the treasury
 * has not heard. Downloading empties them, which is why they read as a queue
 * rather than a pile — anything left is something still to send.
 *
 * Reversed carries two kinds of bill. One bounced. The other was paid and
 * downloaded, and sits here so a payment marked by mistake can be undone
 * rather than being lost behind a completed file. Both are answered the same
 * way: Pay Again puts the bill back into Paid, owed a fresh file, so the
 * treasury is told what is true now.
 */
const TABS = [
  {
    key: 'awaiting',
    label: 'Awaiting Payment',
    tone: 'amber',
    // Money is owed on two kinds of bill: one never paid, and one whose
    // payment bounced. Both wait here for the file that asks for payment.
    params: { paymentStatus: 'Unpaid,Payment Reversed', exportState: 'due' },
    download: {},
  },
  {
    key: 'paid',
    label: 'Paid',
    tone: 'green',
    params: { paymentStatus: 'Paid', exportState: 'due' },
    // Downloading tells the treasury these were paid.
    download: { paymentStatus: 'Paid' },
  },
  {
    key: 'downloaded',
    label: 'Downloaded',
    tone: 'blue',
    // Both ends of the desk once their file has gone out.
    params: { paymentStatus: 'Unpaid,Paid', exportState: 'sent' },
    download: { paymentStatus: 'Unpaid', includeExported: 'true' },
  },
  {
    key: 'reversed',
    label: 'Payment Reversed',
    tone: 'red',
    // Everything that can still be taken back: what bounced, and what was
    // paid and has since gone out in a file.
    params: { exportState: 'reversible' },
    download: { paymentStatus: 'Payment Reversed' },
  },
];

export default function Payments() {
  const openRow = useOpenRow();
  const [tab, setTab] = useState('awaiting');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  // The PFMS file can be narrowed to one scheme, because a treasury upload is
  // usually made against one budget head at a time.
  const [scheme, setScheme] = useState('');
  const [schemes, setSchemes] = useState([]);
  const [redownload, setRedownload] = useState(false);
  const [res, setRes] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  // Reversal needs a written reason, so it goes through a confirm step.
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    api.get('/master/categories')
      .then(({ data }) => setSchemes(data.categories || []))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setRes(null);
    api.get('/claims', {
      params: {
        status: 'Approved',
        ...(TABS.find((t) => t.key === tab)?.params || {}),
        // The scheme narrows what is on screen, not only what downloads —
        // choosing one and seeing the same list back says the filter is broken.
        category: scheme || undefined,
        q: query || undefined,
        limit: 100,
      },
    })
      .then(({ data }) => setRes(data))
      .catch((e) => setError(errorText(e)));
  }, [tab, query, scheme]);

  useEffect(load, [load]);

  /*
   * The tab counts are the desk's whole workload, which a search does not
   * change — so they are fetched when the screen opens and after a payment
   * moves a bill, not on every keystroke. Bundled with the list they turned
   * one search into four requests.
   */
  /*
   * The Reversed tab holds bills that bounced and bills that were paid and
   * downloaded, so its count is not "how much came back". The banner needs
   * the bounced ones alone, or it would raise an alarm about payments that
   * went through perfectly well.
   */
  const [bounced, setBounced] = useState(0);
  const [countTick, setCountTick] = useState(0);
  useEffect(() => {
    Promise.all(
      TABS.map((t) =>
        api.get('/claims', {
          params: {
            status: 'Approved',
            ...t.params,
            // The counts answer the same question as the list, so they are
            // asked under the same scheme.
            category: scheme || undefined,
            limit: 1,
          },
        })
          .then(({ data }) => [t.key, data.total])
          .catch(() => [t.key, 0])
      )
    ).then((rows) => setCounts(Object.fromEntries(rows)));

    api.get('/claims', {
      params: { status: 'Approved', paymentStatus: 'Payment Reversed', category: scheme || undefined, limit: 1 },
    })
      .then(({ data }) => setBounced(data.total))
      .catch(() => setBounced(0));
  }, [countTick, scheme]);

  const setPayment = async (c, paymentStatus, remarks = '') => {
    setBusy(c._id);
    setError('');
    try {
      await api.patch(`/claims/${c._id}/payment`, { paymentStatus, remarks });
      setNote(`${c.claimId} → ${paymentStatus}.`);
      setReversing(null);
      setReason('');
      load();
      // A bill just moved between tabs, so the counts are stale.
      setCountTick((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const total = (res?.claims || []).reduce((s, c) => s + c.amount, 0);
  const active = TABS.find((t) => t.key === tab);
  /* Only the two queues hold bills back; the settled tabs are already spent. */
  const guardedTab = tab === 'awaiting' || tab === 'paid';
  /* Downloaded and Reversed each carry bills in more than one state. */
  const mixed = tab === 'downloaded' || tab === 'reversed';

  return (
    <>
      <PageHead
        title="Payments"
        subtitle="Approved bills and where each one stands with the treasury."
      >
        <button
          className="btn primary sm"
          onClick={() =>
            /* Each tab says what its file carries: the awaiting tab asks the
               treasury to pay, the paid tab tells it a payment was made, and
               the two settled tabs re-read what has already gone. */
            downloadFile('/reports/beneficiary.xlsx', {
              ...active.download,
              ...(scheme ? { category: scheme } : {}),
              // The opt-in only means anything where bills are held back.
              ...(redownload && guardedTab ? { includeExported: 'true' } : {}),
            })
              .then((n) => setNote(
                `Downloaded ${n} — ${scheme || 'all schemes'}, ${active.label.toLowerCase()}` +
                (redownload ? ', including bills already exported.' : '.')
              ))
              .then(() => {
                load();
                // A download moves bills from Awaiting into Downloaded, so
                // the tab counts above are stale the moment the file lands.
                setCountTick((n) => n + 1);
              })
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

      {bounced > 0 && tab !== 'reversed' && (
        <Alert kind="warn">
          <strong>{bounced} bill(s)</strong> came back from the treasury and
          still need paying.{' '}
          <button
            className="btn sm"
            style={{ marginLeft: 6 }}
            onClick={() => setTab('reversed')}
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
        >
          <select value={scheme} onChange={(e) => setScheme(e.target.value)}>
            <option value="">All schemes</option>
            {schemes.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
          </select>
        </SearchBox>

        <label className="redownload">
          <input
            type="checkbox"
            checked={redownload}
            onChange={(e) => setRedownload(e.target.checked)}
          />
          <span>
            Include bills already downloaded
            <em>
              Off by default: a bill goes into one file, so PFMS is never asked to
              pay the same vendor twice. Tick this only to rebuild a file that was lost.
            </em>
          </span>
        </label>
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
            {tab === 'reversed'
              ? 'Nothing has bounced, and no payment is waiting to be taken back.'
              : tab === 'downloaded'
                ? 'Nothing has been downloaded yet. Bills move here once they go into a beneficiary file.'
                : tab === 'paid'
                  ? 'No payment is waiting to be told to the treasury.'
                  : 'Nothing is waiting to be paid.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Claim ID</th><th>School</th><th>Scheme</th><th>Account</th>
                  <th className="num">Amount</th>
                  {/* Two tabs hold a mix, so each row says what it is. */}
                  {mixed && <th>State</th>}
                  <th>{tab === 'reversed' ? 'Reversed On' : 'Approved'}</th>
                  {tab === 'reversed' && <th>Reason</th>}
                  <th>Exported</th><th></th>
                </tr>
              </thead>
              <tbody>
                {res.claims.map((c) => (
                  <tr key={c._id} {...openRow(`/claims/${c._id}`, `Open ${c.claimId}`)}>
                    <td>
                      <strong>{c.claimId}</strong>
                      {c.reversalCount > 0 && (
                        <div className="small" style={{ color: 'var(--rose-d)' }}>
                          reversed {c.reversalCount}×
                        </div>
                      )}
                    </td>
                    <td>{c.school?.name}</td>
                    {/* The scheme decides which budget the payment comes out
                        of, so it belongs on the line, not one click away. */}
                    <td className="small">
                      {c.category}
                      {c.budgetHead && <div className="small muted"><code>{c.budgetHead}</code></div>}
                    </td>
                    <td className="small">
                      {c.school?.bank?.accountNumber
                        ? <code>{c.school.bank.accountNumber}</code>
                        : <Badge tone="red">No bank details</Badge>}
                    </td>
                    <td className="num">{inr(c.amount)}</td>
                    {mixed && (
                      <td>
                        <Badge tone={
                          c.paymentStatus === 'Paid' ? 'green'
                          : c.paymentStatus === 'Payment Reversed' ? 'red' : 'amber'
                        }>
                          {c.paymentStatus === 'Unpaid' ? 'Awaiting' : c.paymentStatus}
                        </Badge>
                      </td>
                    )}
                    <td className="small">
                      {dateOf(tab === 'reversed' ? c.reversedAt : c.approvedAt)}
                    </td>
                    {tab === 'reversed' && (
                      <td className="small" style={{ maxWidth: 240 }}>{c.reversalReason}</td>
                    )}
                    <td className="small">
                      {c.lastExportedAt
                        ? <Badge tone="blue">{dateOf(c.lastExportedAt)}</Badge>
                        : <span className="muted">—</span>}
                    </td>
                    {/* The buttons here act on the bill; they must not also
                        open it, so this cell keeps its clicks. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      {/* Two tabs hold a mix of bills, so what a row offers
                          follows the bill's own state, not the tab it is read
                          in. A bill not yet paid can be paid; a paid one can
                          be reversed or undone; a reversed one paid again. */}
                      <div className="row">
                        {c.paymentStatus === 'Unpaid' && (
                          <button className="btn green sm" disabled={busy === c._id}
                                  onClick={() => setPayment(c, 'Paid')}>
                            {busy === c._id ? '…' : 'Mark Paid'}
                          </button>
                        )}
                        {c.paymentStatus === 'Paid' && (
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
                        {c.paymentStatus === 'Payment Reversed' && (
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
