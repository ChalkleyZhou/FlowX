import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api';
import {
  buildProjectSwitchLocation,
  isProjectScopedListPath,
  readCurrentProjectId,
  writeCurrentProjectId,
} from './project-scope';
import type { Project } from './types';

type ProjectScopeValue = {
  projects: Project[];
  loading: boolean;
  projectId: string | null;
  project: Project | null;
  setProjectId: (projectId: string, options?: { to?: string }) => void;
  adoptProject: (projectId: string) => void;
};

const ProjectScopeContext = createContext<ProjectScopeValue | null>(null);

export function ProjectScopeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectIdState] = useState<string | null>(() => readCurrentProjectId());

  const requestedProjectId = searchParams.get('projectId') || projectId;
  useEffect(() => {
    let cancelled = false;
    if (!requestedProjectId) { setProjects([]); setLoading(false); return; }
    setLoading(true);
    void api.getProject(requestedProjectId).then(project => {
      if (cancelled) return;
      setProjects([project]);
      setProjectIdState(project.id);
      writeCurrentProjectId(project.id);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setProjects([]);
      if (reason && typeof reason === 'object' && 'status' in reason && reason.status === 404) {
        if (projectId && requestedProjectId !== projectId) {
          setSearchParams(current => { const next = new URLSearchParams(current);next.set('projectId',projectId);return next; }, {replace:true});
          return;
        }
        writeCurrentProjectId(null); setProjectIdState(null);
        setSearchParams(current => { const next = new URLSearchParams(current); next.delete('projectId'); return next; }, { replace: true });
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestedProjectId, setSearchParams]);

  useEffect(() => {
    if (loading || !isProjectScopedListPath(location.pathname) || searchParams.get('projectId') || !projectId) return;
    setSearchParams(current => { const next = new URLSearchParams(current); next.set('projectId', projectId); return next; }, { replace: true });
  }, [loading, location.pathname, projectId, searchParams, setSearchParams]);

  const value = useMemo<ProjectScopeValue>(() => {
    const resolved = searchParams.get('projectId') || projectId;
    return {
      projects,
      loading,
      projectId: resolved,
      project: projects.find((item) => item.id === resolved) ?? null,
      setProjectId: (nextProjectId: string, options?: { to?: string }) => {
        writeCurrentProjectId(nextProjectId);
        setProjectIdState(nextProjectId);
        const target = options?.to
          ?? buildProjectSwitchLocation(location.pathname, location.search, nextProjectId)
          ?? `/dashboard?projectId=${encodeURIComponent(nextProjectId)}`;
        navigate(target);
      },
      adoptProject: (nextProjectId: string) => {
        writeCurrentProjectId(nextProjectId);
        setProjectIdState(nextProjectId);
      },
    };
  }, [loading, location.pathname, location.search, navigate, projectId, projects, searchParams]);

  return <ProjectScopeContext.Provider value={value}>{children}</ProjectScopeContext.Provider>;
}

export function useProjectScope() {
  const value = useContext(ProjectScopeContext);
  if (!value) {
    throw new Error('useProjectScope 必须在 ProjectScopeProvider 内使用');
  }
  return value;
}

export function useProjectScopeOptional() {
  return useContext(ProjectScopeContext);
}

/** 地址栏优先；地址还没写上时用本机当前项目，避免列表先空一帧。 */
export function useScopedProjectId() {
  const [searchParams] = useSearchParams();
  const scope = useProjectScopeOptional();
  return searchParams.get('projectId') || scope?.projectId || '';
}

export function LegacyProjectEntryRedirect() {
  const { projectId = '' } = useParams();
  writeCurrentProjectId(projectId);
  return <Navigate to={`/project-settings?projectId=${encodeURIComponent(projectId)}`} replace />;
}

export function useAdoptProject(projectId?: string | null) {
  const scope = useContext(ProjectScopeContext);
  useEffect(() => {
    if (!projectId) return;
    writeCurrentProjectId(projectId);
    scope?.adoptProject(projectId);
  }, [projectId, scope]);
}
