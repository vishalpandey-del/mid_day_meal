import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { errorText, fileUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Card, Spinner } from '../components/UI.jsx';
import { dateOf, dateTimeOf, inr, inrFull, ROLE_LABEL } from '../utils/format.js';

const Row = ({ label, children }) => (
  <div style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid #f1f5f9', gap: 12 }}>
    <div className="small muted" style={{ width: 160, flexShrink: 0 }}>{label}</div>
    <div style={{ flex: 1 }}>{children}</div>
  </div>
);

/**
 * One bill on its own page: every field, the full review trail, and only the
 * actions the signed-in role is actually allowed to take.
 */
export default function ClaimDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [claim, setClaim] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [action, setAction] = useState(null);

  const load = useCallback(() => {
    api.get(`/claims/${id}`)
      .then(({ data }) => setClaim(data.claim))
      .catch((e) => setError(errorText(e)));
  }, [id]);

  useEffect(load, [load]);

  const run = async (fn, successNote) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setNote(successNote);
      setAction(null);
      setText('');
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !claim) return <Alert kind="error">{error}</Alert>;
  if (!claim) return <Spinner />;

  const role = user?.role;
  const s = claim.status;

  // Which buttons this role may see, given where the bill currently sits.
  const canMakerEdit = role === 'school_maker' && ['Draft', 'Returned'].includes(s);
  const canMakerSubmit = role === 'school_maker' && ['Draft', 'Returned'].includes(s);
  const canMakerRespond = role === 'school_maker' && s === 'Under Query';
  const canChecker = role === 'school_checker' && s === 'Pending Checker Review';
  const canDc = role === 'dc' && ['Submitted', 'Resubmitted', 'Under Query'].includes(s);
  const canPay = role === 'dc' && s === 'Approved';
  const canRevise = role === 'dc' && claim.lastExportedAt;
  // A rejection is the DC's decision, so only the DC can take it back.
  const canReopen = role === 'dc' && s === 'Rejected';

  const act = {
    forward: () => api.post(`/claims/${id}/forward`, { remarks: text }),
    return: () => api.post(`/claims/${id}/return`, { remarks: text }),
    approve: () => api.post(`/claims/${id}/approve`, { remarks: text }),
    reject: () => api.post(`/claims/${id}/reject`, { remarks: text }),
    query: () => api.post(`/claims/${id}/query`, { queryText: text }),
    respond: () => {
      const fd = new FormData();
      fd.append('response', text);
      return api.post(`/claims/${id}/respond`, fd);
    },
    submit: () => api.post(`/claims/${id}/submit`),
    revise: () => api.patch(`/claims/${id}/revise-status`, { status: 'Rejected', remarks: text }),
    reopen: () => api.post(`/claims/${id}/reopen`, { remarks: text }),
  };

  const LABEL = {
    forward: 'Forward with remark', return: 'Return to maker',
    approve: 'Approve', reject: 'Reject', query: 'Raise query',
    respond: 'Respond to query', revise: 'Revise status after export',
    reopen: 'Withdraw the rejection',
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>{claim.claimId}</h2>
          <div className="small muted">{claim.school?.name} · {claim.block?.name || claim.school?.block}</div>
        </div>
        <div className="row">
          <Badge>{s}</Badge>
          {s === 'Approved' && <Badge>{claim.paymentStatus}</Badge>}
          <button className="btn sm" onClick={() => navigate(-1)}>Back</button>
        </div>
      </div>

      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{note}</Alert>

      {claim.lastExportedAt && (
        <Alert kind="warn">
          This bill was included in a beneficiary file downloaded on{' '}
          {dateOf(claim.lastExportedAt)}. Any status change from here needs a written reason.
        </Alert>
      )}
      {s === 'Returned' && claim.returnReason && (
        <Alert kind="error"><strong>Returned:</strong> {claim.returnReason}</Alert>
      )}
      {s === 'Under Query' && claim.queryText && (
        <Alert kind="warn"><strong>Query from DC:</strong> {claim.queryText}</Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, alignItems: 'start' }}>
        <div>
          <Card title="Vendor &amp; Payment Details">
            <Row label="Vendor Name">{claim.vendorName}</Row>
            <Row label="Account Number"><code>{claim.vendorBankAccount}</code></Row>
            <Row label="IFSC">{claim.vendorIfsc || '—'}</Row>
            <Row label="Bank">{claim.vendorBankName || '—'}</Row>
            <Row label="GSTIN">{claim.vendorGstin || '—'}</Row>
          </Card>

          <Card title="Scheme &amp; Bill">
            <Row label="Scheme">{claim.category}</Row>
            <Row label="Budget Head"><code>{claim.budgetHead}</code></Row>
            <Row label="Bill Number">{claim.billNumber}</Row>
            <Row label="Bill Date">{dateOf(claim.billDate)}</Row>
            <Row label="Amount"><strong style={{ fontSize: 16 }}>{inrFull(claim.amount)}</strong></Row>
            {claim.description && <Row label="Description">{claim.description}</Row>}
          </Card>

          <Card title={`Documents (${claim.attachments?.length || 0})`}>
            {claim.attachments?.length ? claim.attachments.map((a) => (
              <Row key={a.storedName} label={a.kind === 'query_response' ? 'Query reply' : a.kind}>
                <a href={fileUrl(`/claims/${claim._id}/attachments/${a.storedName}`)}
                   target="_blank" rel="noreferrer">{a.originalName}</a>
                <span className="small muted"> · {Math.round((a.sizeBytes || 0) / 1024)} KB</span>
              </Row>
            )) : <div className="muted small">No documents attached.</div>}
          </Card>

          <Card title="Review Trail">
            <ul className="timeline">
              {claim.history?.map((h, i) => (
                <li key={i}>
                  <strong>{h.action}</strong>
                  <div className="small">
                    {h.by} · <span className="muted">{ROLE_LABEL[h.role] || h.role}</span>
                  </div>
                  {h.note && <div className="small" style={{ marginTop: 3 }}>{h.note}</div>}
                  <div className="when">{dateTimeOf(h.at)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div>
          <Card title="Actions">
            {!action ? (
              <div className="row">
                {canMakerEdit && (
                  <button className="btn" onClick={() => navigate(`/claims/new?edit=${claim._id}`)}>
                    {s === 'Returned' ? 'Correct & Send Back' : 'Edit'}
                  </button>
                )}
                {canMakerSubmit && (
                  <button className="btn primary" disabled={busy}
                          onClick={() => run(act.submit, 'Sent for checker review.')}>
                    {s === 'Returned' ? 'Send Back As Is' : 'Submit for Review'}
                  </button>
                )}
                {canMakerRespond && <button className="btn primary" onClick={() => setAction('respond')}>Respond to Query</button>}
                {canChecker && (
                  <>
                    <button className="btn green" onClick={() => setAction('forward')}>Forward to DC</button>
                    <button className="btn red" onClick={() => setAction('return')}>Return to Maker</button>
                  </>
                )}
                {canDc && (
                  <>
                    <button className="btn green" onClick={() => setAction('approve')}>Approve</button>
                    <button className="btn amber" onClick={() => setAction('query')}>Raise Query</button>
                    <button className="btn red" onClick={() => setAction('reject')}>Reject</button>
                  </>
                )}
                {canPay && (
                  <button
                    className={claim.paymentStatus === 'Paid' ? 'btn' : 'btn green'}
                    disabled={busy}
                    onClick={() => run(
                      () => api.patch(`/claims/${id}/payment`, {
                        paymentStatus: claim.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid',
                      }),
                      `Marked ${claim.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid'}.`
                    )}
                  >
                    Mark {claim.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid'}
                  </button>
                )}
                {canReopen && (
                  <button className="btn" onClick={() => setAction('reopen')}>
                    Withdraw Rejection
                  </button>
                )}
                {canRevise && <button className="btn red" onClick={() => setAction('revise')}>Revise Status</button>}

                {!canMakerEdit && !canMakerSubmit && !canMakerRespond && !canChecker &&
                 !canDc && !canPay && !canRevise && !canReopen && (
                  <div className="muted small">
                    No action is available to you for a bill in “{s}”.
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="field">
                  <label>{LABEL[action]}</label>
                  <textarea
                    rows={4}
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                      action === 'approve' ? 'Optional remark'
                      : action === 'query' ? 'What must the school clarify?'
                      : action === 'revise' ? 'Why is this changing after the file was downloaded?'
                      : action === 'reopen' ? 'Why is the rejection being withdrawn?'
                      : 'Enter your remark'
                    }
                  />
                  {action !== 'approve' && (
                    <div className="hint">
                      {action === 'forward' ? 'At least 3 characters.' : 'At least 5 characters.'}
                    </div>
                  )}
                </div>
                <div className="row">
                  <button className="btn primary" disabled={busy}
                          onClick={() => run(act[action], `${LABEL[action]} — done.`)}>
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                  <button className="btn" onClick={() => { setAction(null); setText(''); }} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card title="Status">
            <Row label="Submitted">{dateOf(claim.submittedAt)}</Row>
            <Row label="Decided">{dateOf(claim.decidedAt)}</Row>
            <Row label="Age">{claim.ageDays} day(s){claim.pausedDays ? ` · ${claim.pausedDays} paused` : ''}</Row>
            {claim.checkerRemarks && <Row label="Checker">{claim.checkerRemarks}</Row>}
            {claim.blockRemarks && <Row label="Block">{claim.blockRemarks}</Row>}
            {claim.dcRemarks && <Row label="DC">{claim.dcRemarks}</Row>}
            {claim.queryResponse && <Row label="Query reply">{claim.queryResponse}</Row>}
            {claim.paymentRef && <Row label="Payment ref">{claim.paymentRef}</Row>}
          </Card>

          <Card title="School">
            <Row label="Name">{claim.school?.name}</Row>
            <Row label="Code"><code>{claim.school?.code}</code></Row>
            <Row label="Account">{claim.school?.bank?.accountNumber || <span className="muted">Not on record</span>}</Row>
            <Row label="IFSC">{claim.school?.bank?.ifsc || '—'}</Row>
          </Card>
        </div>
      </div>
    </>
  );
}
