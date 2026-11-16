import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { useAuth } from './context/AuthContext.jsx';
import AuditPage from './pages/AuditPage.jsx';
import CaseDetailPage from './pages/CaseDetailPage.jsx';
import CasesPage from './pages/CasesPage.jsx';
import CustodyPage from './pages/CustodyPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EvidenceDetailPage from './pages/EvidenceDetailPage.jsx';
import EvidencePage from './pages/EvidencePage.jsx';
import FindingsPage from './pages/FindingsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

/** Shows the page only to roles holding the permission. The server enforces the same rule. */
function Guard({ permission, children }) {
  const { can } = useAuth();
  if (permission && !can(permission)) return <div className="panel empty">You do not have access to this screen.</div>;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading text="Starting…" />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/evidence" element={<EvidencePage />} />
        <Route path="/evidence/:id" element={<EvidenceDetailPage />} />
        <Route path="/custody" element={<CustodyPage />} />
        <Route path="/findings" element={<FindingsPage />} />
        <Route path="/users" element={<Guard permission="user.manage"><UsersPage /></Guard>} />
        <Route path="/reports" element={<Guard permission="report.view"><ReportsPage /></Guard>} />
        <Route path="/audit" element={<Guard permission="audit.view"><AuditPage /></Guard>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
