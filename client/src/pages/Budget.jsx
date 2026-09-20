import { useCallback, useEffect, useState } from 'react';
import api, { errorText } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Card, Empty, Field, PageHead, Spinner, Tile } from '../components/UI.jsx';
import { dateOf, inr, lakhs } from '../utils/format.js';
import useOpenRow from '../utils/useOpenRow.js';

const Bar = ({ used, of }) => {
  const pct = of ? Math.min((used / of) * 100, 100) : 0;
  return (
    <div className={`bar ${used > of ? 'over' : ''}`} title={`${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
};

/**
 * Budget flows State → DC → School. Each role sees the hop it controls,
 * schools see only their own position.
 */
export default function Budget() {
  const openRow = useOpenRow();
  const { user } = useAuth();
  const role = user?.role;
  const isState = ['state', 'admin'].includes(role);
  const isDc = role === 'dc';

  const [view, setView] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [targets, setTargets] = useState([]);
  const [heads, setHeads] = useState([]);
  const [form, setForm] = useState({ target: '', budgetHead: '', allocated: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setView(null);
    try {
      if (isState) {
        const { data } = await api.get('/budget', { params: { level: 'dc' } });
        setView({ kind: 'state', budgets: data.budgets, fy: data.financialYear });
      } else if (isDc) {
        const { data } = await api.get('/budget/dc/me');
        setView({ kind: 'dc', ...data });
      } else if (user?.school) {
        const id = user.school._id || user.school;
        const [status, led] = await Promise.all([
          api.get(`/budget/school/${id}`),
          api.get(`/budget/school/${id}/ledger`).catch(() => null),
        ]);
        setView({ kind: 'school', ...status.data });
        if (led) setLedger(led.data);
      } else {
        setView({ kind: 'none' });
      }
    } catch (e) {
      setError(errorText(e));
    }
  }, [isState, isDc, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/master/categories').then(({ data }) =>
      setHeads([...new Set(data.categories.map((c) => c.budgetHead))])).catch(() => {});
    if (isState) {
      api.get('/master/dc-offices').then(({ data }) =>
        setTargets(data.offices.map((o) => ({ id: o._id, label: `${o.district} (${o.districtId})` })))).catch(() => {});
    } else if (isDc) {
      api.get('/master/schools', { params: { limit: 200 } }).then(({ data }) =>
        setTargets(data.schools.map((s) => ({ id: s._id, label: `${s.name} (${s.code})` })))).catch(() => {});
    }
  }, [isState, isDc]);

  const allocate = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setNote('');
    try {
      const body = {
        budgetHead: form.budgetHead,
        allocated: Number(form.allocated),
        ...(isState ? { dcOffice: form.target } : { school: form.target }),
      };
      const { data } = await api.post(isState ? '/budget/dc' : '/budget/school', body);
      setNote(data.revised
        ? `Allocation revised from ${inr(data.previous)} to ${inr(data.budget.allocated)}.`
        : `Allocated ${inr(data.budget.allocated)}.`);
      setForm({ target: '', budgetHead: '', allocated: '' });
      load();
    } catch (e2) {
      setError(errorText(e2));
    } finally {
      setBusy(false);
    }
  };

  if (error && !view) return <Alert kind="error">{error}</Alert>;
  if (!view) return <Spinner />;

  return (
    <>
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{note}</Alert>

      {(isState || isDc) && (
        <Card title={isState ? 'Allocate to a District' : 'Allocate to a School'}>
          <form onSubmit={allocate}>
            <div className="grid3">
              <Field label={isState ? 'District *' : 'School *'}>
                <select value={form.target} required
                        onChange={(e) => setForm({ ...form, target: e.target.value })}>
                  <option value="">— Select —</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Budget Head *">
                <select value={form.budgetHead} required
                        onChange={(e) => setForm({ ...form, budgetHead: e.target.value })}>
                  <option value="">— Select —</option>
                  {heads.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="Amount (₹) *"
                     hint={isDc ? 'Cannot exceed what this office received.' : ''}>
                <input type="number" min="0" required value={form.allocated}
                       onChange={(e) => setForm({ ...form, allocated: e.target.value })} />
              </Field>
            </div>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Allocate'}
            </button>
          </form>
        </Card>
      )}

      {view.kind === 'state' && (
        <Card title={`District Allocations · FY ${view.fy}`} padded={false}>
          {view.budgets.length === 0 ? <Empty>No allocations yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>District</th><th>Budget Head</th><th className="num">Allocated</th><th>Revisions</th></tr></thead>
                <tbody>
                  {view.budgets.map((b) => (
                    <tr key={b._id}>
                      <td>{b.dcOffice?.name || '—'}</td>
                      <td><code>{b.budgetHead}</code></td>
                      <td className="num">{inr(b.allocated)}</td>
                      <td className="small muted">{b.revisions?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {(view.kind === 'dc' || view.kind === 'school') && (
        <>
          <div className="tiles">
            <Tile label="Allocated" value={lakhs(view.totals.allocated)} />
            {view.kind === 'dc' && (
              <>
                <Tile label="Distributed" value={lakhs(view.totals.distributed)} tone="green" />
                <Tile label="Undistributed" value={lakhs(view.totals.undistributed)} tone="amber" />
              </>
            )}
            <Tile label="Committed" value={lakhs(view.totals.committed)} tone="purple" />
            {view.kind === 'school' && (
              <Tile label="Available" value={lakhs(view.totals.available)}
                    tone={view.totals.available < 0 ? 'red' : 'green'} />
            )}
          </div>

          <Card title={`By Budget Head · FY ${view.financialYear}`} padded={false}>
            {view.rows.length === 0 ? <Empty>No allocation on record yet.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Budget Head</th><th className="num">Allocated</th>
                      {view.kind === 'dc' && <th className="num">Distributed</th>}
                      <th className="num">Committed</th>
                      {view.kind === 'school' && <th className="num">Available</th>}
                      <th style={{ width: 140 }}>Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((r) => (
                      <tr key={r.budgetHead}>
                        <td><code>{r.budgetHead}</code></td>
                        <td className="num">{inr(r.allocated)}</td>
                        {view.kind === 'dc' && <td className="num">{inr(r.distributed)}</td>}
                        <td className="num">{inr(r.committed)}</td>
                        {view.kind === 'school' && (
                          <td className="num" style={{ color: r.available < 0 ? 'var(--red)' : undefined }}>
                            {inr(r.available)}
                          </td>
                        )}
                        <td>
                          <Bar used={r.committed} of={r.allocated} />
                          <span className="small muted">{r.utilisation ?? 0}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {ledger?.entries?.length > 0 && (
        <Card
          title={`Where the money went · FY ${ledger.financialYear}`}
          padded={false}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Claim ID</th><th>Scheme</th><th>Budget Head</th><th>Bill Date</th>
                  <th className="num">Balance Before</th>
                  <th className="num">Bill Amount</th>
                  <th className="num">Balance After</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.map((e) => (
                  <tr key={e.claimId} {...openRow(`/claims/${e.claimId}`, `Open ${e.claimId}`)}>
                    <td><strong>{e.claimId}</strong></td>
                    <td className="small">{e.category}</td>
                    <td><code>{e.budgetHead}</code></td>
                    <td className="small">{dateOf(e.billDate)}</td>
                    <td className="num">
                      {e.unbudgeted ? <span className="muted">no allocation</span> : inr(e.balanceBefore)}
                    </td>
                    <td className="num" style={{ color: 'var(--rose-d)', fontWeight: 700 }}>
                      − {inr(e.amount)}
                    </td>
                    <td className="num" style={{
                      fontWeight: 700,
                      color: e.balanceAfter < 0 ? 'var(--rose-d)' : 'var(--ink)',
                    }}>
                      {e.unbudgeted ? '—' : inr(e.balanceAfter)}
                    </td>
                    <td><Badge>{e.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#F8FAFD', fontWeight: 700 }}>
                  <td colSpan={4}>Total drawn this year</td>
                  <td className="num">{inr(ledger.totals.allocated)}</td>
                  <td className="num" style={{ color: 'var(--rose-d)' }}>− {inr(ledger.totals.spent)}</td>
                  <td className="num" style={{ color: ledger.totals.available < 0 ? 'var(--rose-d)' : 'var(--em-d)' }}>
                    {inr(ledger.totals.available)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {view.kind === 'none' && <Empty>No budget is linked to your login.</Empty>}
    </>
  );
}
