import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, Empty, Field } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';

/**
 * One school's waiting bills, decided in one sitting.
 *
 * The district works school by school: same head teacher, same questions, one
 * conversation. So this opens a school, not a scheme — but the bills inside
 * are grouped by scheme, because the scheme decides which budget the money
 * leaves and a district approving is committing that budget.
 *
 * Everything is ticked when it opens. Bills can be unticked to leave some
 * behind, and a whole scheme can be dropped in one click.
 */
export default function BatchReview({ batch, busy, onApprove, onClose }) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState(() => new Set(batch.claims.map((c) => c._id)));
  const [remarks, setRemarks] = useState('');

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleScheme = (claims) => setPicked((prev) => {
    const next = new Set(prev);
    const ids = claims.map((c) => c._id);
    const allOn = ids.every((id) => next.has(id));
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    return next;
  });

  const chosen = batch.claims.filter((c) => picked.has(c._id));
  const total = chosen.reduce((s, c) => s + c.amount, 0);
  const allPicked = picked.size === batch.claims.length;
  const schemes = batch.schemes || [{ category: 'All', claims: batch.claims, count: batch.count, total: batch.total }];

  return (
    <div className="batch-sheet" role="dialog" aria-modal="true" aria-label="Review this school's bills">
      <div className="batch-panel">
        <header className="batch-head">
          <div>
            <h2>{batch.school?.name}</h2>
            <p>
              <code>{batch.school?.code}</code>
              {batch.block?.name && <> · {batch.block.name} block</>}
              {' · '}{batch.count} bill(s) across {schemes.length} scheme(s) ·{' '}
              <strong>{inr(batch.total)}</strong>
              {batch.breached > 0 && <> · <Badge tone="red">{batch.breached} past SLA</Badge></>}
            </p>
          </div>
          <div className="row">
            <button
              className="btn sm"
              onClick={() => setPicked(allPicked ? new Set() : new Set(batch.claims.map((c) => c._id)))}
              disabled={busy}
            >
              {allPicked ? 'Untick all' : 'Tick all'}
            </button>
            <button className="btn sm" onClick={onClose} disabled={busy}>Close</button>
          </div>
        </header>

        <div className="batch-body">
          {batch.breached > 0 && (
            <Alert kind="warn">
              {batch.breached} of these has been waiting past the SLA. The oldest is{' '}
              {batch.oldestDays} day(s) old.
            </Alert>
          )}

          {schemes.map((sc) => {
            const ids = sc.claims.map((c) => c._id);
            const on = ids.filter((id) => picked.has(id)).length;
            return (
              <section className="batch-scheme" key={sc.category}>
                <div className="batch-scheme-head">
                  <label>
                    <input
                      type="checkbox"
                      checked={on === ids.length}
                      ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length; }}
                      onChange={() => toggleScheme(sc.claims)}
                    />
                    <span>
                      <strong>{sc.category}</strong>
                      {sc.budgetHead && <code>{sc.budgetHead}</code>}
                    </span>
                  </label>
                  <span className="small muted">
                    {on === sc.count ? `${sc.count} bill(s)` : `${on} of ${sc.count}`} · {inr(sc.total)}
                  </span>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}></th>
                        <th>Claim ID</th><th>Vendor</th><th>Bill No.</th>
                        <th>Bill Date</th><th className="num">Amount</th>
                        <th className="num">Age</th><th>Docs</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sc.claims.map((c) => (
                        <tr key={c._id} style={{ opacity: picked.has(c._id) ? 1 : 0.45 }}>
                          <td>
                            <input type="checkbox" checked={picked.has(c._id)} onChange={() => toggle(c._id)} />
                          </td>
                          <td><strong>{c.claimId}</strong></td>
                          <td className="small">{c.vendorName}</td>
                          <td className="small">{c.billNumber}</td>
                          <td className="small">{dateOf(c.billDate)}</td>
                          <td className="num">{inr(c.amount)}</td>
                          <td className="num">
                            <Badge tone={c.slaBucket === 'breached' ? 'red' : c.slaBucket === 'reminder' ? 'amber' : 'green'}>
                              {c.ageDays}d
                            </Badge>
                          </td>
                          <td className="small muted">{c.attachments?.length || 0}</td>
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
              </section>
            );
          })}

          {chosen.length === 0 && <Empty>Nothing ticked — nothing will be approved.</Empty>}

          <Field label="Remark for all of these" hint="Recorded against every bill you approve here.">
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Verified against the sanction order"
            />
          </Field>
        </div>

        <footer className="batch-foot">
          <div className="batch-tally">
            <strong>{chosen.length}</strong> of {batch.count} selected
            <span>{inr(total)}</span>
          </div>
          <div className="row">
            <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              className="btn green"
              disabled={busy || chosen.length === 0}
              onClick={() => onApprove(chosen.map((c) => c._id), remarks)}
            >
              {busy ? 'Approving…' : `Approve ${chosen.length} bill(s) · ${inr(total)}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
