import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { FilterBar } from '../components/FilterBar';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input as UiInput } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import type { Project, Requirement, Workspace } from '../types';

const AI_PROVIDER_STORAGE_KEY = 'flowx-default-ai-provider';

export function RequirementsPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [launchModalRequirement, setLaunchModalRequirement] = useState<Requirement | null>(null);
  const [launchRepositoryIds, setLaunchRepositoryIds] = useState<string[]>([]);
  const [launchAiProvider, setLaunchAiProvider] = useState<'codex' | 'cursor'>('codex');
  const [defaultAiProvider, setDefaultAiProvider] = useState<'codex' | 'cursor'>('codex');
  const [availableAiProviders, setAvailableAiProviders] = useState<Array<{ id: 'codex' | 'cursor'; label: string }>>([
    { id: 'codex', label: 'Codex' },
    { id: 'cursor', label: 'Cursor CLI' },
  ]);
  const [launchSubmitting, setLaunchSubmitting] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    projectId: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    repositoryIds: [] as string[],
  });
  const toast = useToast();
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === createDraft.projectId) ?? null,
    [createDraft.projectId, projects],
  );
  const availableRepositories = selectedProject?.workspace.repositories ?? [];

  const filteredProjects = useMemo(
    () => projects.filter((project) => !selectedWorkspaceId || project.workspace.id === selectedWorkspaceId),
    [projects, selectedWorkspaceId],
  );

  const filteredRequirements = useMemo(
    () =>
      requirements.filter((item) => {
        if (selectedWorkspaceId && item.project.workspace.id !== selectedWorkspaceId) {
          return false;
        }
        if (selectedProjectId && item.project.id !== selectedProjectId) {
          return false;
        }
        return true;
      }),
    [requirements, selectedProjectId, selectedWorkspaceId],
  );

  const requirementSummary = useMemo(() => {
    const workspaceSet = new Set(requirements.map((item) => item.project.workspace.id));
    const projectSet = new Set(requirements.map((item) => item.project.id));
    return {
      requirementCount: requirements.length,
      visibleCount: filteredRequirements.length,
      workspaceCount: workspaceSet.size,
      projectCount: projectSet.size,
    };
  }, [filteredRequirements.length, requirements]);

  async function refresh() {
    setLoading(true);
    try {
      const [workspaceList, projectList, requirementList, workflowProviderConfig] = await Promise.all([
        api.getWorkspaces(),
        api.getProjects(),
        api.getRequirements(),
        api.getWorkflowProviders(),
      ]);
      setWorkspaces(workspaceList);
      setProjects(projectList);
      setRequirements(requirementList);
      setAvailableAiProviders(workflowProviderConfig.providers);
      const storedProvider =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY)
          : null;
      const preferredProvider =
        storedProvider === 'cursor' || storedProvider === 'codex'
          ? storedProvider
          : workflowProviderConfig.defaultProvider;
      setDefaultAiProvider(preferredProvider);
      setLaunchAiProvider(preferredProvider);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载需求失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createRequirement(values: {
    projectId: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
    repositoryIds: string[];
  }) {
    try {
      await api.createRequirement(values);
      setCreateDraft({
        projectId: '',
        title: '',
        description: '',
        acceptanceCriteria: '',
        repositoryIds: [],
      });
      setCreateModalOpen(false);
      setSelectedProjectId(values.projectId);
      await refresh();
      toast.success('需求创建成功');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建需求失败');
    }
  }

  async function startWorkflow(requirementId: string) {
    setLaunchSubmitting(true);
    try {
      const run = await api.createWorkflowRun(
        requirementId,
        launchRepositoryIds.length > 0 ? launchRepositoryIds : undefined,
        launchAiProvider,
      );
      toast.success('工作流已启动');
      setLaunchModalRequirement(null);
      setLaunchRepositoryIds([]);
      setLaunchAiProvider(defaultAiProvider);
      navigate(`/workflow-runs/${run.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动工作流失败');
    } finally {
      setLaunchSubmitting(false);
    }
  }

  function updateDefaultAiProvider(nextProvider: 'codex' | 'cursor') {
    setDefaultAiProvider(nextProvider);
    setLaunchAiProvider(nextProvider);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, nextProvider);
    }
  }

  async function handleCreateRequirement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createDraft.projectId) {
      toast.error('请选择项目');
      return;
    }

    if (!createDraft.title.trim() || !createDraft.description.trim() || !createDraft.acceptanceCriteria.trim()) {
      toast.error('请完整填写需求信息');
      return;
    }

    await createRequirement({
      projectId: createDraft.projectId,
      title: createDraft.title.trim(),
      description: createDraft.description.trim(),
      acceptanceCriteria: createDraft.acceptanceCriteria.trim(),
      repositoryIds: createDraft.repositoryIds,
    });
  }

  function toggleRepository(repositoryId: string) {
    setCreateDraft((current) => {
      const exists = current.repositoryIds.includes(repositoryId);
      return {
        ...current,
        repositoryIds: exists
          ? current.repositoryIds.filter((id) => id !== repositoryId)
          : [...current.repositoryIds, repositoryId],
      };
    });
  }

  function renderRepositoryScope(requirement: Requirement) {
    const repositories = requirement.requirementRepositories?.map((entry) => entry.repository) ?? [];
    if (repositories.length === 0) {
      return '未单独指定仓库范围，将继承项目工作区的默认仓库上下文。';
    }

    return repositories.map((repository) => repository.name).join('、');
  }

  function getActiveWorkflowRuns(requirement: Requirement) {
    return (requirement.workflowRuns ?? []).filter(
      (run) => !['DONE', 'FAILED'].includes(run.status),
    );
  }

  function renderActiveWorkflowScope(requirement: Requirement) {
    const activeRuns = getActiveWorkflowRuns(requirement);
    if (activeRuns.length === 0) {
      return '当前没有进行中的工作流。';
    }

    return activeRuns
      .map((run) => {
        const repositories = run.workflowRepositories?.map((repository) => repository.name) ?? [];
        const scopeLabel = repositories.length > 0 ? repositories.join('、') : '未记录仓库范围';
        return `${run.id.slice(-6)} · ${run.status} · ${scopeLabel}`;
      })
      .join(' | ');
  }

  function getRequirementDefaultRepositories(requirement: Requirement) {
    if ((requirement.requirementRepositories?.length ?? 0) > 0) {
      return requirement.requirementRepositories!.map((entry) => entry.repository);
    }
    return requirement.project.workspace.repositories;
  }

  function toggleLaunchRepository(repositoryId: string) {
    setLaunchRepositoryIds((current) =>
      current.includes(repositoryId)
        ? current.filter((id) => id !== repositoryId)
        : [...current, repositoryId],
    );
  }

  return (
    <>
      <Dialog
        open={Boolean(launchModalRequirement)}
        onOpenChange={(open) => {
          if (!open) {
            setLaunchModalRequirement(null);
            setLaunchRepositoryIds([]);
            setLaunchAiProvider(defaultAiProvider);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>启动工作流</DialogTitle>
            <DialogDescription>
              留空则使用这条需求的默认仓库范围；如果只想并行推进其中一部分仓库，可以在这里手动缩小范围。
            </DialogDescription>
          </DialogHeader>
          {launchModalRequirement ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">{launchModalRequirement.title}</div>
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  默认范围：{renderRepositoryScope(launchModalRequirement)}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[var(--text)]">AI 执行器</label>
                  <Select
                    value={launchAiProvider}
                    onValueChange={(value: 'codex' | 'cursor') => setLaunchAiProvider(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择执行器" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAiProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-slate-500">
                    Codex 适合当前默认链路；Cursor 会通过服务器上的 `cursor-agent` 执行。
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-[var(--text)]">本次工作流仓库范围</label>
                  <span className="text-xs leading-5 text-slate-500">不选则按默认范围启动</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {getRequirementDefaultRepositories(launchModalRequirement).map((repository) => {
                    const selected = launchRepositoryIds.includes(repository.id);
                    return (
                      <UiButton
                        key={repository.id}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleLaunchRepository(repository.id)}
                      >
                        {selected ? '已选' : '选择'} {repository.name}
                      </UiButton>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <UiButton
                  variant="outline"
                  onClick={() => {
                    setLaunchModalRequirement(null);
                    setLaunchRepositoryIds([]);
                    setLaunchAiProvider(defaultAiProvider);
                  }}
                >
                  取消
                </UiButton>
                <UiButton
                  onClick={() => void startWorkflow(launchModalRequirement.id)}
                  disabled={launchSubmitting}
                >
                  {launchSubmitting ? '启动中...' : '确认启动'}
                </UiButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) {
            setCreateDraft({
              projectId: '',
              title: '',
              description: '',
              acceptanceCriteria: '',
              repositoryIds: [],
            });
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>创建需求</DialogTitle>
            <DialogDescription>填写基础信息后，这条需求会先归档到项目，再发起工作流。</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreateRequirement(event)}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]">所属项目</label>
              <Select
                value={createDraft.projectId || undefined}
                onValueChange={(value) =>
                  setCreateDraft((current) => ({
                    ...current,
                    projectId: value,
                    repositoryIds: [],
                  }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择需求归属的项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="requirement-title">需求标题</label>
              <UiInput
                id="requirement-title"
                value={createDraft.title}
                onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="AI研发调度系统 MVP"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="requirement-description">需求描述</label>
              <Textarea
                id="requirement-description"
                rows={4}
                value={createDraft.description}
                onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="描述产品目标、范围和约束边界。"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-[var(--text)]" htmlFor="requirement-acceptance">验收标准</label>
              <Textarea
                id="requirement-acceptance"
                rows={4}
                value={createDraft.acceptanceCriteria}
                onChange={(event) => setCreateDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
                placeholder="列出本次迭代必须满足的验收检查点。"
              />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-semibold text-[var(--text)]">影响仓库范围</label>
                <span className="text-xs leading-5 text-slate-500">不选则默认继承项目工作区全部仓库</span>
              </div>
              {selectedProject ? (
                availableRepositories.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availableRepositories.map((repository) => {
                      const selected = createDraft.repositoryIds.includes(repository.id);
                      return (
                        <UiButton
                          key={repository.id}
                          type="button"
                          variant={selected ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleRepository(repository.id)}
                        >
                          {selected ? '已选' : '选择'} {repository.name}
                        </UiButton>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-slate-500">当前项目所在工作区还没有可选仓库。</p>
                )
              ) : (
                <p className="text-sm leading-6 text-slate-500">先选择项目，再指定这条需求实际影响的仓库。</p>
              )}
            </div>
            <UiButton type="submit" className="mt-2">
              创建需求
            </UiButton>
          </form>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Requirements"
        title="需求录入与流程发起"
        description="需求现在先归属于项目，再沿着项目所在工作区继承代码上下文和执行链路。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="需求总数" value={requirementSummary.requirementCount} />
        <MetricCard label="当前筛选结果" value={requirementSummary.visibleCount} />
        <MetricCard label="涉及工作区" value={requirementSummary.workspaceCount} />
        <MetricCard label="涉及项目" value={requirementSummary.projectCount} />
      </div>
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Requirement Pool"
            title="需求列表"
            extra={
              <FilterBar className="border-0 bg-transparent p-0">
                <Select
                  value={defaultAiProvider}
                  onValueChange={(value: 'codex' | 'cursor') => updateDefaultAiProvider(value)}
                >
                  <SelectTrigger className="min-w-[220px]">
                    <SelectValue placeholder="默认执行器" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAiProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        默认执行器：{provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedWorkspaceId ?? '__all__'}
                  onValueChange={(value) => {
                    setSelectedWorkspaceId(value === '__all__' ? undefined : value);
                    setSelectedProjectId(undefined);
                  }}
                >
                  <SelectTrigger className="min-w-[220px]">
                    <SelectValue placeholder="按工作区筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部工作区</SelectItem>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedProjectId ?? '__all__'}
                  onValueChange={(value) => setSelectedProjectId(value === '__all__' ? undefined : value)}
                >
                  <SelectTrigger className="min-w-[220px]">
                    <SelectValue placeholder="按项目筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部项目</SelectItem>
                    {filteredProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <UiButton onClick={() => setCreateModalOpen(true)}>
                  新增需求
                </UiButton>
              </FilterBar>
            }
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredRequirements.length > 0 ? (
            <div className="record-list-stack">
              {filteredRequirements.map((item) => (
                <RecordListItem
                  key={item.id}
                  title={<div className="text-base font-semibold leading-6 text-slate-950">{item.title}</div>}
                  badges={
                    <>
                      <Badge variant="secondary">{item.project.name}</Badge>
                      <Badge variant="outline">{item.project.workspace.name}</Badge>
                      <Badge variant="default">{item.workflowRuns?.length ?? 0} 条工作流</Badge>
                      <Badge variant={getActiveWorkflowRuns(item).length > 0 ? 'warning' : 'outline'}>
                        {getActiveWorkflowRuns(item).length} 条活跃流
                      </Badge>
                      <Badge variant="outline">
                        {(item.requirementRepositories?.length ?? 0) > 0
                          ? `${item.requirementRepositories?.length ?? 0} 个目标仓库`
                          : '默认仓库范围'}
                      </Badge>
                    </>
                  }
                  description={<p className="leading-6">{item.description}</p>}
                  details={(
                    <>
                      <p className="text-sm leading-6 text-slate-500">{item.acceptanceCriteria}</p>
                      <p className="text-sm leading-6 text-slate-500">仓库范围：{renderRepositoryScope(item)}</p>
                      <p className="text-sm leading-6 text-slate-500">并行占用：{renderActiveWorkflowScope(item)}</p>
                    </>
                  )}
                  actions={
                    <>
                      <UiButton
                        variant="outline"
                        onClick={() => {
                          setLaunchModalRequirement(item);
                          setLaunchRepositoryIds([]);
                        }}
                      >
                        启动工作流
                      </UiButton>
                      <UiButton variant="outline" onClick={() => navigate(`/workflow-runs?requirementId=${item.id}`)}>
                        查看流程
                      </UiButton>
                    </>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState description="还没有录入任何需求，先创建一条需求开始推进。" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
