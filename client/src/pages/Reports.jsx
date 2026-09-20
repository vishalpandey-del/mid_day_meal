import { useState } from 'react';
import { downloadFile, errorText } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Card, PageHead } from '../components/UI.jsx';

const ALL = [
  { url: '/reports/claims.xlsx', title: 'Claim Register',
    desc: 'Every bill in your scope with status, payment and ageing.', roles: '*' },
  { url: '/reports/beneficiary.xlsx', title: 'PFMS Beneficiary File',
    desc: 'Approved bills only, in the Add Beneficiary Details layout.',
    roles: ['dc', 'state', 'admin'], primary: true },
  { url: '/reports/sla.xlsx', title: 'SLA Monitor',
    desc: 'Bills pending with the DC, bucketed by age.', roles: ['dc', 'state', 'admin'] },
  { url: '/reports/block-summary.xlsx', title: 'Block Summary',
    desc: 'Block-wise totals, approvals and payments.', roles: ['dc', 'state', 'admin'] },
  { url: '/reports/audit.xlsx', title: 'Audit Trail',
    desc: 'Every recorded action, oldest to newest.', roles: ['state', 'admin'] },
];

export default function Reports() {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const list = ALL.filter((r) => r.roles === '*' || r.roles.includes(user?.role));

  const go = async (r) => {
    setBusy(r.url); setError(''); setNote('');
    try {
      const name = await downloadFile(r.url);
      setNote(`Downloaded ${name}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHead title="Reports" subtitle="Download the register, payment file and oversight sheets." />
      <Alert kind="error">{error}</Alert>
      <Alert kind="ok">{note}</Alert>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 16 }}>
        {list.map((r) => (
          <Card key={r.url} title={r.title}>
            <p className="small muted" style={{ marginTop: 0 }}>{r.desc}</p>
            {r.url.includes('beneficiary') && (
              <div className="alert warn small" style={{ padding: '8px 11px' }}>
                Downloading stamps these bills. Changing a status afterwards will require a written reason.
              </div>
            )}
            <button className={`btn ${r.primary ? 'primary' : ''}`}
                    disabled={busy === r.url} onClick={() => go(r)}>
              {busy === r.url ? 'Preparing…' : 'Download Excel'}
            </button>
          </Card>
        ))}
      </div>
    </>
  );
}
