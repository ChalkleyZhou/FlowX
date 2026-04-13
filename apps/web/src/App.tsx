import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { BugsPage } from './pages/BugsPage';
import { BugDetailPage } from './pages/BugDetailPage';
import { IssuesPage } from './pages/IssuesPage';
import { IssueDetailPage } from './pages/IssueDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RequirementDetailPage } from './pages/RequirementDetailPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { WorkflowRunDetailPage } from './pages/WorkflowRunDetailPage';
import { WorkflowRunsPage } from './pages/WorkflowRunsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { ProtectedLayout, ProtectedRoute } from './routes/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ToastProvider } from './components/ui/toast';
import { ThemeProvider } from './components/theme-provider';

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={<Navigate to="/workspaces" replace />}
          />
          <Route
            element={<ProtectedLayout />}
          >
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/requirements" element={<RequirementsPage />} />
            <Route path="/requirements/:id" element={<RequirementDetailPage />} />
            <Route path="/workflow-runs" element={<WorkflowRunsPage />} />
            <Route path="/workflow-runs/:workflowRunId" element={<WorkflowRunDetailPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="/issues/:issueId" element={<IssueDetailPage />} />
            <Route path="/bugs" element={<BugsPage />} />
            <Route path="/bugs/:bugId" element={<BugDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
