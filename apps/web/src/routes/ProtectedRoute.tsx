import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { AppLayout } from '../components/AppLayout';
import { Spinner } from '../components/ui/spinner';

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-10 w-10" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export function ProtectedLayout() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-10 w-10" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
