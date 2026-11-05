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
  const [projectsReady, setProjectsReady] = useState(false);
  const [projectId, setProjectIdState] = useState<string | null>(() => readCurrentProjectId());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.getProjects()
      .then((list) => {
        if (!cancelled) {
          setProjects(list);
          setProjectsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || !projectsReady) return;
    const urlId = searchParams.get('projectId');
    const urlValid = urlId && projects.some((item) => item.id === urlId) ? urlId : null;
    if (urlValid) {
      if (readCurrentProjectId() !== urlValid) writeCurrentProjectId(urlValid);
      setProjectIdState((current) => (current === urlValid ? current : urlValid));
      return;
    }
    if (!isProjectScopedListPath(location.pathname)) {
      return;
    }
    const stored = readCurrentProjectId();
    const storedValid = stored && projects.some((item) => item.id === stored) ? stored : null;
    if (!storedValid) {
      if (stored) writeCurrentProjectId(null);
      setProjectIdState(null);
      if (urlId) {
        const next = new URLSearchParams(searchParams);
        next.delete('projectId');
        setSearchParams(next, { replace: true });
      }
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('projectId', storedValid);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    setProjectIdState(storedValid);
  }, [loading, location.pathname, projects, projectsReady, searchParams, setSearchParams]);

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
