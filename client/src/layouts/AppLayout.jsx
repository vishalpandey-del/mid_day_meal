import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABEL } from '../utils/format.js';
import api, { errorText } from '../api/client.js';
import { Alert, Confirm, Field } from '../components/UI.jsx';

/** Which screens each role is allowed to reach. */
const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', roles: '*', end: true },
    { to: '/queue', label: 'My Queue', roles: ['school_maker', 'school_checker', 'dc'] },
  ]},
  { group: 'My Network', items: [
    // The label names whatever sits directly under this role.
    { to: '/network', label: 'Districts & Blocks', roles: ['state', 'admin'] },
    { to: '/network', label: 'My Blocks & Schools', roles: ['dc'] },
    { to: '/network', label: 'My Schools', roles: ['block'] },
    { to: '/network', label: 'My School', roles: ['school_maker', 'school_checker'] },
  ]},
  { group: 'Bills', items: [
    // `end` so that /claims/new does not light this up as well.
    { to: '/claims', label: 'All Claims', roles: '*', end: true },
    { to: '/claims/new', label: 'New Bill', roles: ['school_maker'] },
    { to: '/payments', label: 'Payments', roles: ['dc'] },
  ]},
  { group: 'Funds', items: [
    { to: '/budget', label: 'Budget', roles: ['dc', 'state', 'admin', 'school_maker', 'school_checker'] },
  ]},
  { group: 'Reports', items: [
    { to: '/reports', label: 'Reports', roles: '*' },
  ]},
  { group: 'Administration', items: [
    { to: '/admin/master', label: 'Master Upload', roles: ['admin'] },
    { to: '/admin/logins', label: 'Login Manager', roles: ['admin'] },
    { to: '/admin/hierarchy', label: 'Hierarchy', roles: ['admin', 'state'] },
    { to: '/admin/users', label: 'Users & Transfers', roles: ['admin', 'dc'] },
    { to: '/admin/audit', label: 'Audit Trail', roles: ['admin', 'state'] },
  ]},
];

const allowed = (roles, role) => roles === '*' || roles.includes(role);

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Everyone can change their own password, whatever their role.
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwErr, setPwErr] = useState('');
  const [pwNote, setPwNote] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const openPw = () => {
    setPw({ currentPassword: '', newPassword: '', confirm: '' });
    setPwErr(''); setPwNote(''); setPwOpen(true);
  };

  const savePw = async () => {
    if (pw.newPassword.length < 6) return setPwErr('The new password must be at least 6 characters.');
    if (pw.newPassword !== pw.confirm) return setPwErr('The two new passwords do not match.');
    setPwBusy(true); setPwErr('');
    try {
      await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      setPwOpen(false);
      setPwNote('Your password has been changed.');
    } catch (e) {
      setPwErr(errorText(e));
    } finally {
      setPwBusy(false);
    }
  };

  const place =
    user?.school?.name ||
    (user?.block ? `${user.block.name} Block` : '') ||
    (user?.dcOffice ? `${user.dcOffice.district} District` : '') ||
    'State-wide';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <h1>Vidyaposhan</h1>
            <span>SSA Assam · Bill Claim Portal</span>
          </div>
        </div>
        <nav>
          {NAV.map((g) => {
            const items = g.items.filter((i) => allowed(i.roles, user?.role));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="nav-group">{g.group}</div>
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end}>
                    <span>{i.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-.4px' }}>
              {place}
            </div>
            <div className="small" style={{ color: 'var(--txt-l)', marginTop: 1 }}>
              {ROLE_LABEL[user?.role] || user?.role}
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="who">
              <strong>{user?.name}</strong>
              <span>{user?.userId}</span>
            </div>
            <div className="avatar" title={user?.name}>{initials(user?.name)}</div>
            <button className="btn sm" onClick={openPw}>My Account</button>
            <button className="btn sm" onClick={() => { logout(); navigate('/login'); }}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">
          {pwNote && <Alert kind="ok">{pwNote}</Alert>}
          <Outlet />
        </main>
      </div>

      <Confirm
        open={pwOpen}
        title="Change your password"
        onCancel={() => setPwOpen(false)}
        onConfirm={savePw}
        confirmLabel="Change Password"
        busy={pwBusy}
      >
        <p className="small muted">
          Signed in as <strong>{user?.userId}</strong> · {ROLE_LABEL[user?.role] || user?.role}
        </p>
        {pwErr && <Alert kind="error">{pwErr}</Alert>}
        <Field label="Current password">
          <input type="password" value={pw.currentPassword} autoFocus
                 onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </Field>
        <Field label="New password" hint="At least 6 characters.">
          <input type="password" value={pw.newPassword}
                 onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" value={pw.confirm}
                 onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </Field>
      </Confirm>
    </div>
  );
}
