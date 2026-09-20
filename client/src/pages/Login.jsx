import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorText } from '../api/client.js';

/**
 * Everyone signs in at the same place with the id their office was issued —
 * the portal reads the role from the account, so there is nothing to pick
 * and nothing to get wrong. The left panel says what the portal is; the
 * right panel is the only thing to fill in.
 */
const STAGES = [
  ['Raise', 'The school enters the bill with its vendor and scheme details.'],
  ['Verify', 'The school checker reviews it and sends it to the district.'],
  ['Approve', 'The district office approves and releases the payment.'],
];

export default function Login() {
  const { login } = useAuth();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    <div className="signin">
      <section className="signin-brand">
        <div className="signin-mark">
          <span className="signin-logo">📚</span>
          <div>
            <h1>Vidyaposhan</h1>
            <p>SSA Assam · Dhubri District</p>
          </div>
        </div>

        <h2>Online Bill Claim Management</h2>
        <p className="signin-lede">
          One record for every school bill, from the day it is raised to the day
          the money reaches the vendor.
        </p>

        <ol className="signin-flow">
          {STAGES.map(([name, what], i) => (
            <li key={name}>
              <span className="signin-step">{i + 1}</span>
              <div>
                <strong>{name}</strong>
                <span>{what}</span>
              </div>
            </li>
          ))}
        </ol>

        <p className="signin-foot">Government of Assam · Samagra Shiksha</p>
      </section>

      <section className="signin-panel">
        <form className="signin-form" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="signin-hint">
            Use the user ID issued to your office. It decides what you see.
          </p>

          {error && <div className="alert error">{error}</div>}

          <div className="field">
            <label htmlFor="userId">User ID</label>
            <input
              id="userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value.toUpperCase())}
              placeholder="Enter your user ID"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck="false"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="signin-pw">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button className="btn primary signin-go" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="signin-note">
            Forgotten your password? Your district office can reset it.
          </p>
          <p className="signin-secure">🔒 Every sign-in and action on this portal is recorded.</p>
        </form>
      </section>
    </div>
  );
}
