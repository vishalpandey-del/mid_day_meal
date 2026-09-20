import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { Spinner } from './components/UI.jsx';

import Login from './pages/Login.jsx';
// Loaded on demand: it is the only screen that needs the charting library.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
import MyQueue from './pages/MyQueue.jsx';
import ClaimList from './pages/ClaimList.jsx';
import Network from './pages/Network.jsx';
import SchoolDetail from './pages/SchoolDetail.jsx';
import ClaimDetail from './pages/ClaimDetail.jsx';
import NewClaim from './pages/NewClaim.jsx';
import Payments from './pages/Payments.jsx';
import Budget from './pages/Budget.jsx';
import Reports from './pages/Reports.jsx';
import MasterUpload from './pages/admin/MasterUpload.jsx';
import LoginManager from './pages/admin/LoginManager.jsx';
import Hierarchy from './pages/admin/Hierarchy.jsx';
import Users from './pages/admin/Users.jsx';
import AuditTrail from './pages/admin/AuditTrail.jsx';

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

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        <Route index element={<Suspense fallback={<Spinner />}><Dashboard /></Suspense>} />
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
        <Route path="admin/users" element={<Guard roles={admin}><Users /></Guard>} />
        <Route path="admin/audit" element={<Guard roles={adminState}><AuditTrail /></Guard>} />
        <Route path="*" element={<div className="alert error">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
