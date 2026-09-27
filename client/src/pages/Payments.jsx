import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile, errorText } from '../api/client.js';
import { Alert, Badge, Card, Confirm, Empty, PageHead, SearchBox, Spinner, Tile } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';
import useDebounced from '../utils/useDebounced.js';
import useOpenRow from '../utils/useOpenRow.js';

/**
 * The DC payment desk. A bill travels one road, and comes back to its start
 * if the money does.
 *
 *   Awaiting Payment  approved, or bounced — money is owed, the treasury has
 *                     not been told to pay it
 *   Downloaded        in a file, sent to the treasury
 *   Paid              marked paid here, the treasury has not been told yet
 *   Payment Reversed  paid and downloaded: settled, and standing there only
 *                     so a payment marked in error can still be taken back
 *
 * Downloading a tab empties it, so Awaiting and Paid read as queues — what is
 * left is what the treasury has not heard.
 *
 * A bill in Payment Reversed has been paid and told to the treasury; that is
 * what downloading the paid file means. The one thing left to do with it is
 * take the payment back, and doing so returns it to Awaiting as an unpaid
 * bill, to travel the same road again. There is no second way to pay: the
 * road that paid it the first time is the road that pays it the next.
 */
const TABS = [
  {
    key: 'awaiting',
    label: 'Awaiting Payment',
    tone: 'amber',
    params: { paymentStatus: 'Unpaid', exportState: 'due' },
    // Downloading tells the treasury to pay these.
    download: { paymentStatus: 'Unpaid' },
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
    // Settled bills, kept reachable in case a payment was marked in error.
    params: { paymentStatus: 'Paid', exportState: 'sent' },
    download: { paymentStatus: 'Paid', includeExported: 'true' },
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
  /*
   * A treasury batch usually bounces whole, not a bill at a time, so the
   * reversed tab lets several be ticked and reversed together — one reason
   * recorded against each, which is what the audit trail needs anyway.
   */
  const [picked, setPicked] = useState(new Set());
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
  const [countTick, setCountTick] = useState(0);
  /* Anything that changes the list changes what is on screen, so the ticks go. */
  useEffect(() => { setPicked(new Set()); }, [tab, scheme, query]);
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

  /* Reverse everything ticked, one call each, and say what refused. */
  const reverseMany = async () => {
    const rows = (res?.claims || []).filter((c) => picked.has(c._id) && c.paymentStatus === 'Paid');
    if (!rows.length) return;

    /*
     * The reason is checked here, before a single call goes out. Left to the
     * server it would refuse every bill in turn — fifty rejections for one
     * missing sentence — and the dialog would close on the way, taking the
     * box to write it in with it.
     */
    if (reason.trim().length < 5) {
      setError('Say why these payments came back — at least 5 characters. It is recorded against each bill.');
      return;
    }

    setBusy('bulk');
    setError('');
    const failed = [];
    let done = 0;
    for (const c of rows) {
      try {
        await api.patch(`/claims/${c._id}/payment`, { paymentStatus: 'Payment Reversed', remarks: reason });
        done += 1;
      } catch (e) {
        failed.push(`${c.claimId}: ${errorText(e)}`);
      }
    }
    setNote(`${done} payment(s) reversed.` + (failed.length ? ` ${failed.length} could not be.` : ''));
    if (failed.length) setError(failed.slice(0, 3).join(' · '));
    setBusy('');
    // The dialog stays open if anything refused, so the reader sees which.
    if (!failed.length) {
      setReversing(null);
      setReason('');
    }
    setPicked(new Set());
    load();
    setCountTick((n) => n + 1);
  };

  const total = (res?.claims || []).reduce((s, c) => s + c.amount, 0);
  const active = TABS.find((t) => t.key === tab);
  /* Only the two queues hold bills back; the settled tabs are already spent. */
  const guardedTab = tab === 'awaiting' || tab === 'paid';
  /* Only Downloaded carries bills in more than one state, so only it needs
     to say which each row is. */
  const mixed = tab === 'downloaded';
  /* The reversed tab lists settled payments, so it reads as a receipt. */
  const settledTab = tab === 'reversed';

  /*
   * Ticking is offered on the reversed tab, where every row is a settled
   * payment that can still be taken back. Selection is kept to what is on
   * screen, so a reversal can never reach a row the reader cannot see.
   */
  const selectable = tab === 'reversed'
    ? (res?.claims || []).filter((c) => c.paymentStatus === 'Paid')
    : [];
  const selectableIds = selectable.map((c) => c._id);
  const pickedRows = selectable.filter((c) => picked.has(c._id));
  const pickedTotal = pickedRows.reduce((sum, c) => sum + c.amount, 0);
  const allPicked = selectable.length > 0 && selectableIds.every((id) => picked.has(id));
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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

      <Card
        title={`${active.label} · ${res?.total ?? '…'}`}
        padded={false}
        actions={pickedRows.length > 0 ? (
          <div className="row">
            <span className="small muted">
              {pickedRows.length} selected · {inr(pickedTotal)}
            </span>
            <button
              className="btn red sm"
              disabled={busy === 'bulk'}
              onClick={() => { setReversing('bulk'); setReason(''); }}
            >
              {busy === 'bulk' ? 'Reversing…' : `Reverse ${pickedRows.length}`}
            </button>
          </div>
        ) : null}
      >
        {!res ? (
          <Spinner />
        ) : res.claims.length === 0 ? (
          <Empty>
            {tab === 'reversed'
              ? 'No payment has gone out that could still be taken back.'
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
                  {selectable.length > 0 && (
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={allPicked}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(selectableIds))}
                      />
                    </th>
                  )}
                  <th>Claim ID</th><th>School</th><th>Scheme</th><th>Account</th>
                  <th className="num">Amount</th>
                  {/* Downloaded holds a mix, so each row says what it is. */}
                  {mixed && <th>State</th>}
                  {/* These bills are settled, so the paid date and the
                      treasury's reference are what a reader needs. */}
                  <th>{settledTab ? 'Paid On' : 'Approved'}</th>
                  {settledTab && <th>Reference</th>}
                  <th>Exported</th><th></th>
                </tr>
              </thead>
              <tbody>
                {res.claims.map((c) => (
                  <tr key={c._id} {...openRow(`/claims/${c._id}`, `Open ${c.claimId}`)}>
                    {selectable.length > 0 && (
                      /* Ticking is selecting, not opening. */
                      <td onClick={(e) => e.stopPropagation()}>
                        {c.paymentStatus === 'Paid' && (
                          <input
                            type="checkbox"
                            checked={picked.has(c._id)}
                            onChange={() => toggle(c._id)}
                          />
                        )}
                      </td>
                    )}
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
                        <Badge tone={c.paymentStatus === 'Paid' ? 'green' : 'amber'}>
                          {c.paymentStatus === 'Unpaid' ? 'Awaiting' : c.paymentStatus}
                        </Badge>
                      </td>
                    )}
                    <td className="small">
                      {dateOf(settledTab ? c.paidAt : c.approvedAt)}
                    </td>
                    {settledTab && (
                      <td className="small">
                        {c.paymentRef ? <code>{c.paymentRef}</code> : <span className="muted">—</span>}
                      </td>
                    )}
                    <td className="small">
                      {c.lastExportedAt
                        ? <Badge tone="blue">{dateOf(c.lastExportedAt)}</Badge>
                        : <span className="muted">—</span>}
                    </td>
                    {/* The buttons here act on the bill; they must not also
                        open it, so this cell keeps its clicks. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      {/* What a row offers follows the bill's own state, since
                          Downloaded holds both, and the tab it is read in. The
                          reversed tab exists to take a payment back, so it
                          offers that and nothing else; Undo belongs on the
                          Paid tab, where the payment is still being decided. */}
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
                            {tab !== 'reversed' && (
                              <button className="btn sm" disabled={busy === c._id}
                                      onClick={() => setPayment(c, 'Unpaid')}>
                                Undo
                              </button>
                            )}
                          </>
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
        title={reversing === 'bulk'
          ? `Reverse ${pickedRows.length} payment(s)?`
          : `Reverse payment for ${reversing?.claimId || ''}?`}
        onCancel={() => setReversing(null)}
        onConfirm={() => {
          // One bill or fifty, the reason is asked for before anything is sent.
          if (reason.trim().length < 5) {
            setError('Say why the payment came back — at least 5 characters. It is recorded in the audit trail.');
            return;
          }
          return reversing === 'bulk'
            ? reverseMany()
            : setPayment(reversing, 'Payment Reversed', reason);
        }}
        confirmLabel="Mark Reversed"
        busy={busy === 'bulk' || busy === reversing?._id}
      >
        <p className="small">
          {reversing === 'bulk'
            ? <>These {pickedRows.length} bill(s), {inr(pickedTotal)} altogether, move to{' '}
              <strong>Payment Reversed</strong> and come back into the PFMS file, so they get
              paid again. The same reason is recorded against each, and every school is notified.</>
            : <>The bill moves to <strong>Payment Reversed</strong> and comes back into the
              PFMS file, so it gets paid again. The school is notified.</>}
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
