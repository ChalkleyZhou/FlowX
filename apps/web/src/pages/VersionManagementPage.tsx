import { GitBranch } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ProjectRequiredState } from '../components/ProjectRequiredState';
import { ProjectVersionsPanel } from '../components/ProjectVersionsPanel';
import { useProjectScopeOptional } from '../project-scope-context';

export function VersionManagementPage() {
  const scope = useProjectScopeOptional();
  const projectId = scope?.projectId ?? '';
  const project = scope?.project;

  if (!projectId) {
    return (
      <>
        <PageHeader
          eyebrow="Release Management"
          title="版本管理"
          description="按当前项目维护发布版本，并进入版本工作项查看需求、问题和缺陷。"
          icon={GitBranch}
        />
        <ProjectRequiredState />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Release Management"
        title="版本管理"
        description={`${project?.name ?? '当前项目'}：维护发布版本，并按版本查看需求、问题和缺陷。`}
        icon={GitBranch}
      />
      <ProjectVersionsPanel
        projectId={projectId}
        currentVersionId={project?.currentVersionId}
      />
    </>
  );
}
