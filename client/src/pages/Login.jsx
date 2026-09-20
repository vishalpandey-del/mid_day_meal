import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorText } from '../api/client.js';

/**
 * Picking a role prefills the matching demo User ID, so a reviewer can sign
 * in without remembering six different ids.
 */
const ROLE_CARDS = [
  { key: 'school', icon: '🏫', label: 'School', sub: 'Maker & Checker', userId: 'MKR18140100' },
  { key: 'block', icon: '🏢', label: 'Block Office', sub: 'Review & forward', userId: 'BLK180101' },
  { key: 'dc', icon: '🏛️', label: 'District (DC)', sub: 'Approve & pay', userId: 'DC1801' },
  { key: 'state', icon: '📊', label: 'SSA / State', sub: 'State monitoring', userId: 'STATE001' },
];

export default function Login() {
  const { login } = useAuth();
  const [picked, setPicked] = useState('');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (r) => {
    setPicked(r.key);
    setUserId(r.userId);
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(userId.trim(), password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-box" onSubmit={submit}>
        <div className="row" style={{ gap: 10, marginBottom: 6, flexWrap: 'nowrap' }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'linear-gradient(135deg,var(--sky),#0056A8)',
              display: 'grid', placeItems: 'center', fontSize: 20,
              boxShadow: '0 4px 12px rgba(14,165,233,.35)', flexShrink: 0,
            }}
          >
            📚
          </div>
          <h1>Vidyaposhan</h1>
        </div>
        <div className="sub">SSA Assam · Online Bill Claim Management Portal</div>

        {error && <div className="alert error">{error}</div>}

        <div
          style={{
            fontSize: 11, fontWeight: 700, color: 'var(--txt-m)',
            marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.5px',
          }}
        >
          Select your role to continue
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          {ROLE_CARDS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => pick(r)}
              style={{
                padding: '11px 8px',
                border: `2px solid ${picked === r.key ? 'var(--sky)' : 'var(--bd)'}`,
                borderRadius: 10,
                textAlign: 'center',
                background: picked === r.key ? 'var(--sky-g)' : 'var(--surf)',
                transition: 'all .15s',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{r.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{r.label}</div>
              <div style={{ fontSize: 10, color: 'var(--txt-m)', marginTop: 1 }}>{r.sub}</div>
            </button>
          ))}
        </div>

        <div className="field">
          <label>User ID</label>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. MKR18140100"
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
        </div>

        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center', padding: 11, fontSize: 14, marginTop: 4 }}
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Sign in securely →'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: 'var(--txt-l)' }}>
          🔒 Government of Assam Portal · All sessions are logged
        </div>
      </form>
    </div>
  );
}
