import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorText } from '../api/client.js';
import { Alert, Card, Field, PageHead } from '../components/UI.jsx';
import { inr } from '../utils/format.js';

const BLANK = {
  vendorName: '', vendorBankAccount: '', vendorIfsc: '', vendorBankName: '', vendorGstin: '',
  category: '', billNumber: '', billDate: '', amount: '', description: '',
};

/**
 * Bill entry. Field order follows the paper form: vendor bank details and the
 * scheme come first, the bill itself afterwards.
 */
export default function NewClaim() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');

  const [form, setForm] = useState(BLANK);
  const [files, setFiles] = useState([]);
  const [categories, setCategories] = useState([]);
  // The server's ceiling depends on where it runs, so it is asked rather
  // than assumed; a file over it is rejected here instead of failing mid-upload.
  const [maxMb, setMaxMb] = useState(4);
  // Vercel measures the whole request, so three small pages can be refused
  // together even though each one passes. The total is checked as well.
  const [maxTotalMb, setMaxTotalMb] = useState(4);
  // What the school has left for the chosen scheme. Asked as soon as a scheme
  // is picked, so the ceiling is visible before an amount is typed rather than
  // arriving as a refusal once the whole form is filled in.
  const [budget, setBudget] = useState(null);
  const [checking, setChecking] = useState(false);
  // A returned bill is corrected and sent back in one step, so the form needs
  // to know it is looking at one.
  const [claimStatus, setClaimStatus] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/master/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
    api.get('/limits').then(({ data }) => {
      setMaxMb(data.maxUploadMb);
      setMaxTotalMb(data.maxRequestMb ?? data.maxUploadMb);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api.get(`/claims/${editId}`).then(({ data }) => {
      const c = data.claim;
      setClaimStatus(c.status || '');
      setReturnReason(c.returnReason || '');
      setForm({
        vendorName: c.vendorName || '', vendorBankAccount: c.vendorBankAccount || '',
        vendorIfsc: c.vendorIfsc || '', vendorBankName: c.vendorBankName || '',
        vendorGstin: c.vendorGstin || '', category: c.category || '',
        billNumber: c.billNumber || '',
        billDate: c.billDate ? new Date(c.billDate).toISOString().slice(0, 10) : '',
        amount: String(c.amount || ''), description: c.description || '',
      });
    }).catch((e) => setError(errorText(e)));
  }, [editId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /* Ask the server where the school stands whenever the scheme changes. */
  useEffect(() => {
    if (!form.category) { setBudget(null); return; }
    const head = categories.find((c) => c.name === form.category)?.budgetHead;
    if (!head) return;
    setChecking(true);
    api.get('/budget/headroom', {
      params: {
        budgetHead: head,
        billDate: form.billDate || undefined,
        ...(editId ? { excludeClaimId: editId } : {}),
      },
    })
      .then(({ data }) => setBudget(data.budget))
      .catch(() => setBudget(null))
      .finally(() => setChecking(false));
  }, [form.category, form.billDate, categories, editId]);

  const chosen = categories.find((c) => c.name === form.category);

  /*
   * A school cannot raise a bill it has no room for, so the form refuses it
   * rather than letting the server do it after everything is typed. `spent`
   * counts bills still working their way up the chain as well as approved
   * ones — they are already holding their share of the allocation.
   */
  const noAllocation = budget?.level === 'blocked' && budget.reason === 'no-allocation';
  const left = budget?.available ?? 0;
  const wanted = Number(form.amount) || 0;
  const overBudget = Boolean(budget) && !noAllocation && wanted > left;
  const blocked = noAllocation || overBudget;

  /* Editing something the maker still holds: saving can also send it on. */
  const sendable = Boolean(editId) && ['Returned', 'Draft'].includes(claimStatus);

  const send = async (mode) => {
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (mode === 'draft') fd.append('saveAsDraft', 'true');
      if (mode === 'review') fd.append('sendForReview', 'true');
      files.forEach((f) => fd.append('documents', f));

      const { data } = editId
        ? await api.put(`/claims/${editId}`, fd)
        : await api.post('/claims', fd);

      // The backend warns about budget but never blocks the bill.
      if (data.budget?.level === 'warning') {
        setBudget(data.budget);
        setTimeout(() => navigate(`/claims/${data.claim._id}`), 2600);
      } else {
        navigate(`/claims/${data.claim._id}`);
      }
    } catch (e) {
      setError(errorText(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title={editId ? 'Edit Bill' : 'New Bill'}
        subtitle="Vendor and scheme details first, then the bill itself."
      />

      <Alert kind="error">{error}</Alert>
      {noAllocation && (
        <Alert kind="error">
          <strong>You cannot raise this bill.</strong> {budget.message}
        </Alert>
      )}
      {overBudget && (
        <Alert kind="error">
          <strong>You cannot raise this bill.</strong> {chosen?.name} has{' '}
          <strong>{inr(left)}</strong> left for {budget.financialYear} and this bill is{' '}
          <strong>{inr(wanted)}</strong> — {inr(wanted - left)} more than remains.
          Reduce the amount, or ask your district office to allocate more.
        </Alert>
      )}
      {claimStatus === 'Returned' && returnReason && (
        <Alert kind="warn">
          Sent back by the checker: {returnReason} — correct it below and send it back.
        </Alert>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(sendable ? 'review' : 'save'); }}
        style={{ maxWidth: 820 }}
      >
        <fieldset>
          <legend>1 · Vendor &amp; Payment Details</legend>
          <div className="grid2">
            <Field label="Vendor Name *">
              <input value={form.vendorName} onChange={set('vendorName')} required minLength={2} />
            </Field>
            <Field label="Vendor Account Number *" hint="6–20 digits">
              <input value={form.vendorBankAccount} onChange={set('vendorBankAccount')}
                     required inputMode="numeric" pattern="\d{6,20}" />
            </Field>
            <Field label="IFSC Code" hint="e.g. SBIN0007654">
              <input value={form.vendorIfsc} onChange={set('vendorIfsc')}
                     style={{ textTransform: 'uppercase' }} />
            </Field>
            <Field label="Bank Name">
              <input value={form.vendorBankName} onChange={set('vendorBankName')} />
            </Field>
            <Field label="Vendor GSTIN">
              <input value={form.vendorGstin} onChange={set('vendorGstin')}
                     style={{ textTransform: 'uppercase' }} />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>2 · Scheme / Budget Head</legend>
          <Field
            label="Scheme *"
            hint={chosen ? `Budget head ${chosen.budgetHead}${chosen.maxAmount ? ` · ceiling ${inr(chosen.maxAmount)}` : ''}` : 'The budget head follows from the scheme.'}
          >
            <select value={form.category} onChange={set('category')} required>
              <option value="">— Select scheme —</option>
              {categories.map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
            </select>
          </Field>

          {form.category && (
            <div className="budget-strip">
              {checking ? (
                <span className="muted small">Checking what is left…</span>
              ) : noAllocation ? (
                <span className="budget-none">No budget allocated for this scheme</span>
              ) : budget ? (
                <>
                  <span><b>{inr(budget.allocated)}</b> allocated</span>
                  <span><b>{inr(budget.committed)}</b> already committed</span>
                  <span className={left > 0 ? 'budget-left' : 'budget-none'}>
                    <b>{inr(left)}</b> left to spend
                  </span>
                  <span className="muted small">{budget.financialYear}</span>
                </>
              ) : null}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>3 · Bill Details</legend>
          <div className="grid3">
            <Field label="Bill Number *">
              <input value={form.billNumber} onChange={set('billNumber')} required />
            </Field>
            <Field label="Bill Date *">
              <input type="date" value={form.billDate} onChange={set('billDate')} required />
            </Field>
            <Field
              label="Amount (₹) *"
              hint={
                overBudget ? `${inr(wanted - left)} more than your school has left`
                : chosen?.maxAmount && wanted > chosen.maxAmount ? `Above the ${inr(chosen.maxAmount)} ceiling`
                : budget && !noAllocation ? `Up to ${inr(left)} for this scheme`
                : ''
              }
            >
              <input
                type="number" min="1" value={form.amount} onChange={set('amount')} required
                className={overBudget ? 'over' : ''}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea rows={2} value={form.description} onChange={set('description')} />
          </Field>
        </fieldset>

        <fieldset>
          <legend>4 · Bill Documents</legend>
          <Field
            label="Attach bill copy"
            hint={`PDF, JPG or PNG · up to ${maxMb} MB each, ${maxTotalMb} MB in total · required before submitting`}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => {
                const picked = [...e.target.files];
                const reject = (msg) => {
                  setError(msg);
                  e.target.value = '';
                  setFiles([]);
                };
                const tooBig = picked.filter((f) => f.size > maxMb * 1024 * 1024);
                if (tooBig.length) {
                  return reject(
                    `${tooBig.map((f) => f.name).join(', ')} — each file must be under ${maxMb} MB. ` +
                      'Scan at a lower resolution or split the document.'
                  );
                }
                const total = picked.reduce((sum, f) => sum + f.size, 0);
                if (total > maxTotalMb * 1024 * 1024) {
                  return reject(
                    `Those ${picked.length} files come to ${(total / 1024 / 1024).toFixed(1)} MB together, ` +
                      `and one bill can carry ${maxTotalMb} MB. Attach fewer pages, or scan in black and white.`
                  );
                }
                setError('');
                setFiles(picked);
              }}
            />
          </Field>
          {files.length > 0 && (
            <div className="small muted">
              {files.map((f) => `${f.name} (${Math.round(f.size / 1024)} KB)`).join(' · ')}
              {' · '}
              {(files.reduce((s2, f) => s2 + f.size, 0) / 1024 / 1024).toFixed(1)} MB of {maxTotalMb} MB
            </div>
          )}
        </fieldset>

        <div className="row">
          {/* Nothing can be saved over the allocation — not even a draft, which
              would only move the refusal to the moment it is sent. */}
          <button type="submit" className="btn primary" disabled={busy || blocked}>
            {busy
              ? 'Saving…'
              : !editId
                ? 'Submit for Review'
                : sendable
                  ? 'Save & Send for Review'
                  : 'Save Changes'}
          </button>
          {editId && sendable && (
            <button type="button" className="btn" disabled={busy || blocked} onClick={() => send('save')}>
              Save Without Sending
            </button>
          )}
          {!editId && (
            <button type="button" className="btn" disabled={busy || blocked} onClick={() => send('draft')}>
              Save as Draft
            </button>
          )}
          <button type="button" className="btn" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
