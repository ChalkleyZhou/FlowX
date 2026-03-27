import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { BugsPage } from './pages/BugsPage';
import { BugDetailPage } from './pages/BugDetailPage';
import { IssuesPage } from './pages/IssuesPage';
import { IssueDetailPage } from './pages/IssueDetailPage';
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
        <Route
          path="/issues"
          element={
            <ProtectedRoute>
              <IssuesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/issues/:issueId"
          element={
            <ProtectedRoute>
              <IssueDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bugs"
          element={
            <ProtectedRoute>
              <BugsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bugs/:bugId"
          element={
            <ProtectedRoute>
              <BugDetailPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
