import { Navigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ProjectRequiredState } from '../components/ProjectRequiredState';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { useProjectScopeOptional } from '../project-scope-context';
import type { ProjectVersionSummary } from '../types';
import { VersionWorkItemsPage } from './VersionWorkItemsPage';

export function VersionWorkspacePage() {
  const scope = useProjectScopeOptional();
  const projectId = scope?.projectId ?? '';
  const project = scope?.project;
  const [searchParams, setSearchParams] = useSearchParams();
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const requestedVersionId = searchParams.get('versionId') ?? '';

  useEffect(() => {
    if (!projectId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api.listProjectVersions(projectId, { page: 1, pageSize: 100 })
      .then(result => {
        if (!cancelled) setVersions(result.items);
      })
      .catch(error => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '加载版本失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!projectId) {
    return (
      <>
        <PageHeader eyebrow="Release Workspace" title="版本工作台" description="按版本统一查看需求、问题和缺陷。" />
        <ProjectRequiredState />
      </>
    );
  }

  const selectedVersionId = requestedVersionId || project?.currentVersionId || '';
  if (!requestedVersionId && selectedVersionId) {
    const next = new URLSearchParams(searchParams);
    next.set('versionId', selectedVersionId);
    return <Navigate to={`/versions?${next.toString()}`} replace />;
  }

  if (loading && !versions.length && !selectedVersionId) {
    return <div className="flex min-h-40 items-center justify-center"><Spinner className="h-7 w-7" /></div>;
  }

  if (!selectedVersionId) {
    return (
      <>
        <PageHeader eyebrow="Release Workspace" title="版本工作台" description="按版本统一查看需求、问题和缺陷。" />
        <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          当前项目还没有版本，请先到“版本配置”创建一个版本。
        </div>
      </>
    );
  }

  function changeVersion(versionId: string) {
    const next = new URLSearchParams(searchParams);
    next.set('versionId', versionId);
    setSearchParams(next);
  }

  return (
    <VersionWorkItemsPage
      projectId={projectId}
      versionId={selectedVersionId}
      currentVersionId={project?.currentVersionId ?? undefined}
      onVersionChange={changeVersion}
      showManagementLink
    />
  );
}
