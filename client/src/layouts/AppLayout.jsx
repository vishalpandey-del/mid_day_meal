import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABEL } from '../utils/format.js';

/** Which screens each role is allowed to reach. */
const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', roles: '*', end: true },
    { to: '/queue', label: 'My Queue', roles: ['school_maker', 'school_checker', 'block', 'dc'] },
  ]},
  { group: 'My Network', items: [
    // The label names whatever sits directly under this role.
    { to: '/network', label: 'Districts & Blocks', roles: ['state', 'admin'] },
    { to: '/network', label: 'My Blocks & Schools', roles: ['dc'] },
    { to: '/network', label: 'My Schools', roles: ['block'] },
    { to: '/network', label: 'My School', roles: ['school_maker', 'school_checker'] },
  ]},
  { group: 'Bills', items: [
    { to: '/claims', label: 'All Claims', roles: '*' },
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
    { to: '/admin/users', label: 'Users & Transfers', roles: ['admin'] },
    { to: '/admin/audit', label: 'Audit Trail', roles: ['admin', 'state'] },
  ]},
];

const allowed = (roles, role) => roles === '*' || roles.includes(role);

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
            <button className="btn sm" onClick={() => { logout(); navigate('/login'); }}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
