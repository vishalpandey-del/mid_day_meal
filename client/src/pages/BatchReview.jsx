import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, Empty, Field } from '../components/UI.jsx';
import { dateOf, inr } from '../utils/format.js';

/**
 * One school's bills under one scheme, decided together.
 *
 * A school sends several bills against the same scheme in a month and the
 * district usually decides them as one: same head teacher, same budget head,
 * same question. This shows the whole group at once — every bill's number,
 * vendor, date and amount, with its documents a click away — so the decision
 * is made on what is in front of the reader rather than on ten separate
 * screens. Bills can be unticked to leave some behind.
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

  const chosen = batch.claims.filter((c) => picked.has(c._id));
  const total = chosen.reduce((s, c) => s + c.amount, 0);
  const allPicked = picked.size === batch.claims.length;

  return (
    <div className="batch-sheet" role="dialog" aria-modal="true" aria-label="Review batch">
      <div className="batch-panel">
        <header className="batch-head">
          <div>
            <h2>{batch.school?.name}</h2>
            <p>
              {batch.category} · <code>{batch.budgetHead}</code> · {batch.count} bill(s) ·{' '}
              <strong>{inr(batch.total)}</strong>
              {batch.breached > 0 && <> · <Badge tone="red">{batch.breached} past SLA</Badge></>}
            </p>
          </div>
          <button className="btn sm" onClick={onClose} disabled={busy}>Close</button>
        </header>

        <div className="batch-body">
          {batch.breached > 0 && (
            <Alert kind="warn">
              {batch.breached} of these has been waiting past the SLA. The oldest is{' '}
              {batch.oldestDays} day(s) old.
            </Alert>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(batch.claims.map((c) => c._id)))}
                    />
                  </th>
                  <th>Claim ID</th><th>Vendor</th><th>Bill No.</th>
                  <th>Bill Date</th><th className="num">Amount</th>
                  <th className="num">Age</th><th>Docs</th><th></th>
                </tr>
              </thead>
              <tbody>
                {batch.claims.map((c) => (
                  <tr key={c._id} style={{ opacity: picked.has(c._id) ? 1 : 0.5 }}>
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
