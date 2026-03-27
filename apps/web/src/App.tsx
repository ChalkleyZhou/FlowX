import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { RequirementsPage } from './pages/RequirementsPage';
import { WorkflowRunDetailPage } from './pages/WorkflowRunDetailPage';
import { WorkflowRunsPage } from './pages/WorkflowRunsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={<Navigate to="/workspaces" replace />}
        />
        <Route
          path="/workspaces"
          element={
            <ProtectedRoute>
              <WorkspacesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requirements"
          element={
            <ProtectedRoute>
              <RequirementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workflow-runs"
          element={
            <ProtectedRoute>
              <WorkflowRunsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workflow-runs/:workflowRunId"
          element={
            <ProtectedRoute>
              <WorkflowRunDetailPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
