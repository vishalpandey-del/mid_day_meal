import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { Spinner } from './components/UI.jsx';

/*
 * The sign-in page is the only screen a signed-out visitor can reach, so it
 * is the only one bundled with the shell. Everything behind the login is
 * fetched when first opened — otherwise the login page downloads the whole
 * portal, screens most roles never see included, before anyone has typed a
 * password.
 */
import Login from './pages/Login.jsx';
// Loaded on demand: it is the only screen that needs the charting library.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const MyQueue = lazy(() => import('./pages/MyQueue.jsx'));
const ClaimList = lazy(() => import('./pages/ClaimList.jsx'));
const Network = lazy(() => import('./pages/Network.jsx'));
const SchoolDetail = lazy(() => import('./pages/SchoolDetail.jsx'));
const ClaimDetail = lazy(() => import('./pages/ClaimDetail.jsx'));
const NewClaim = lazy(() => import('./pages/NewClaim.jsx'));
const Payments = lazy(() => import('./pages/Payments.jsx'));
const Budget = lazy(() => import('./pages/Budget.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const MasterUpload = lazy(() => import('./pages/admin/MasterUpload.jsx'));
const LoginManager = lazy(() => import('./pages/admin/LoginManager.jsx'));
const Hierarchy = lazy(() => import('./pages/admin/Hierarchy.jsx'));
const Users = lazy(() => import('./pages/admin/Users.jsx'));
const AuditTrail = lazy(() => import('./pages/admin/AuditTrail.jsx'));

/** Blocks a route unless the signed-in user holds one of `roles`. */
const Guard = ({ roles, children }) => {
  const { user } = useAuth();
  if (roles && !roles.includes(user?.role)) {
    return <div className="alert error">This screen is not available for your role.</div>;
  }
  return children;
};

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner>Checking your session…</Spinner>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const admin = ['admin'];
  const adminState = ['admin', 'state'];
  // A DC administers the block and school logins in its own district.
  const userAdmin = ['admin', 'dc'];

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="queue" element={<MyQueue />} />
        <Route path="network" element={<Network />} />
        <Route path="network/school/:id" element={<SchoolDetail />} />
        <Route path="claims" element={<ClaimList />} />
        <Route path="claims/new" element={<Guard roles={['school_maker']}><NewClaim /></Guard>} />
        <Route path="claims/:id" element={<ClaimDetail />} />
        <Route path="payments" element={<Guard roles={['dc']}><Payments /></Guard>} />
        <Route path="budget" element={<Budget />} />
        <Route path="reports" element={<Reports />} />
        <Route path="admin/master" element={<Guard roles={admin}><MasterUpload /></Guard>} />
        <Route path="admin/logins" element={<Guard roles={admin}><LoginManager /></Guard>} />
        <Route path="admin/hierarchy" element={<Guard roles={adminState}><Hierarchy /></Guard>} />
        <Route path="admin/users" element={<Guard roles={userAdmin}><Users /></Guard>} />
        <Route path="admin/audit" element={<Guard roles={adminState}><AuditTrail /></Guard>} />
        <Route path="*" element={<div className="alert error">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
