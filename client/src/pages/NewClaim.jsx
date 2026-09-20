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
  const [budget, setBudget] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/master/categories').then(({ data }) => setCategories(data.categories)).catch(() => {});
    api.get('/limits').then(({ data }) => setMaxMb(data.maxUploadMb)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api.get(`/claims/${editId}`).then(({ data }) => {
      const c = data.claim;
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

  const chosen = categories.find((c) => c.name === form.category);

  const send = async (asDraft) => {
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (asDraft) fd.append('saveAsDraft', 'true');
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
      {budget && <Alert kind="warn">{budget.message} — the bill was still saved.</Alert>}

      <form onSubmit={(e) => { e.preventDefault(); send(false); }} style={{ maxWidth: 820 }}>
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
              hint={chosen?.maxAmount && Number(form.amount) > chosen.maxAmount
                ? `Above the ${inr(chosen.maxAmount)} ceiling` : ''}
            >
              <input type="number" min="1" value={form.amount} onChange={set('amount')} required />
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
            hint={`PDF, JPG or PNG · up to ${maxMb} MB each · required before submitting`}
          >
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => {
                const picked = [...e.target.files];
                const tooBig = picked.filter((f) => f.size > maxMb * 1024 * 1024);
                if (tooBig.length) {
                  setError(
                    `${tooBig.map((f) => f.name).join(', ')} — each file must be under ${maxMb} MB. ` +
                      'Scan at a lower resolution or split the document.'
                  );
                  e.target.value = '';
                  setFiles([]);
                  return;
                }
                setError('');
                setFiles(picked);
              }}
            />
          </Field>
          {files.length > 0 && (
            <div className="small muted">
              {files.map((f) => `${f.name} (${Math.round(f.size / 1024)} KB)`).join(' · ')}
            </div>
          )}
        </fieldset>

        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : editId ? 'Save Changes' : 'Submit for Review'}
          </button>
          {!editId && (
            <button type="button" className="btn" disabled={busy} onClick={() => send(true)}>
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
