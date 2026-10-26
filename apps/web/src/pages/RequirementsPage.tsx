import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ListToolbar } from '../components/ListToolbar';
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
import { formatPlanningStatus, formatPriority } from '../utils/label-utils';
import { formatRequirementWorkflowScope, getActiveRequirementWorkflows } from '../utils/requirement-workflows';
import { formatWorkflowStatus } from '../utils/workflow-ui';

const emptyCreateDraft = {
  projectId: '',
  title: '',
  description: '',
  acceptanceCriteria: '',
  repositoryIds: [] as string[],
  versionId: '',
};

const AI_PROVIDER_STORAGE_KEY = 'flowx-default-ai-provider';
const ALL_FILTER_VALUE = '__all__';

const planningStatusOptions = [
  { id: 'UNSCHEDULED', label: '未排期' },
  { id: 'SCHEDULED', label: '已排期' },
  { id: 'IN_PROGRESS', label: '进行中' },
  { id: 'DONE', label: '已完成' },
] as const;

const priorityOptions = [
  { id: 'URGENT', label: '紧急' },
  { id: 'HIGH', label: '高' },
  { id: 'MEDIUM', label: '中' },
  { id: 'LOW', label: '低' },
] as const;

export function RequirementsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const createInFlight = useRef(false);
  const [launchModalRequirement, setLaunchModalRequirement] = useState<Requirement | null>(null);
  const [launchRepositoryIds, setLaunchRepositoryIds] = useState<string[]>([]);
  const [launchAiProvider, setLaunchAiProvider] = useState<'codex' | 'cursor'>('codex');
  const [defaultAiProvider, setDefaultAiProvider] = useState<'codex' | 'cursor'>('codex');
  const [availableAiProviders, setAvailableAiProviders] = useState<Array<{ id: 'codex' | 'cursor'; label: string }>>([
    { id: 'codex', label: 'Codex' },
    { id: 'cursor', label: 'Cursor CLI' },
  ]);
  const [launchSubmitting, setLaunchSubmitting] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyCreateDraft);
  const [createMode, setCreateMode] = useState<'manual' | 'prototype'>('manual');
  const [prototypeFile, setPrototypeFile] = useState<File | null>(null);
  const [prototypeGoal, setPrototypeGoal] = useState('');
  const [prototypeProvider, setPrototypeProvider] = useState<'codex' | 'cursor'>('codex');
  const [prototypeError, setPrototypeError] = useState<string | null>(null);
  const [prototypeSubmitting, setPrototypeSubmitting] = useState(false);
  const prototypeInFlight = useRef(false);
  const toast = useToast();
  const selectedWorkspaceId = searchParams.get('workspaceId') ?? undefined;
  const selectedProjectId = searchParams.get('projectId') ?? undefined;
  const selectedVersionId = searchParams.get('versionId') ?? undefined;
  const selectedPlanningStatus = searchParams.get('planningStatus') ?? undefined;
  const selectedPriority = searchParams.get('priority') ?? undefined;
  const hasActiveFilters = Boolean(
    selectedWorkspaceId || selectedProjectId || selectedVersionId || selectedPlanningStatus || selectedPriority,
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === createDraft.projectId) ?? null,
    [createDraft.projectId, projects],
  );
  const availableRepositories = selectedProject?.workspace.repositories ?? [];

  const filteredProjects = useMemo(
    () => projects.filter((project) => !selectedWorkspaceId || project.workspace.id === selectedWorkspaceId),
    [projects, selectedWorkspaceId],
  );

  const versionOptions = useMemo(() => {
    const seen = new Set<string>();
    return projects
      .filter((project) => !selectedWorkspaceId || project.workspace.id === selectedWorkspaceId)
      .filter((project) => !selectedProjectId || project.id === selectedProjectId)
      .flatMap((project) => (project.versions ?? []).map((version) => ({
        id: version.id,
        label: selectedProjectId ? version.name : `${project.name} · ${version.name}`,
      })))
      .filter((version) => {
        if (seen.has(version.id)) return false;
        seen.add(version.id);
        return true;
      });
  }, [projects, selectedProjectId, selectedWorkspaceId]);

  const filteredRequirements = useMemo(
    () =>
      requirements.filter((item) => {
        if (selectedWorkspaceId && item.project.workspace.id !== selectedWorkspaceId) {
          return false;
        }
        if (selectedProjectId && item.project.id !== selectedProjectId) {
          return false;
        }
        if (selectedVersionId && item.versionId !== selectedVersionId) {
          return false;
        }
        if (selectedPlanningStatus && item.planningStatus !== selectedPlanningStatus) {
          return false;
        }
        if (selectedPriority && item.priority !== selectedPriority) {
          return false;
        }
        return true;
      }),
    [requirements, selectedPlanningStatus, selectedPriority, selectedProjectId, selectedVersionId, selectedWorkspaceId],
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
      setHasLoaded(true);
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

  function updateFilterQuery(updates: Record<string, string | undefined>, clearKeys: string[] = []) {
    const nextParams = new URLSearchParams(searchParams);
    clearKeys.forEach((key) => nextParams.delete(key));
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    });
    setSearchParams(nextParams, { replace: true });
  }

  function clearFilters() {
    const nextParams = new URLSearchParams(searchParams);
    ['workspaceId', 'projectId', 'versionId', 'planningStatus', 'priority'].forEach((key) => nextParams.delete(key));
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    const invalidKeys = [
      selectedWorkspaceId && !workspaces.some((workspace) => workspace.id === selectedWorkspaceId) ? 'workspaceId' : null,
      selectedProjectId && (!selectedProject || (selectedWorkspaceId && selectedProject.workspace.id !== selectedWorkspaceId)) ? 'projectId' : null,
      selectedVersionId && !versionOptions.some((version) => version.id === selectedVersionId) ? 'versionId' : null,
      selectedPlanningStatus && !planningStatusOptions.some((option) => option.id === selectedPlanningStatus) ? 'planningStatus' : null,
      selectedPriority && !priorityOptions.some((option) => option.id === selectedPriority) ? 'priority' : null,
    ].filter((key): key is string => Boolean(key));
    if (invalidKeys.length > 0) {
      const nextParams = new URLSearchParams(searchParams);
      invalidKeys.forEach((key) => nextParams.delete(key));
      setSearchParams(nextParams, { replace: true });
    }
  }, [hasLoaded, projects, searchParams, selectedPlanningStatus, selectedPriority, selectedProjectId, selectedVersionId, selectedWorkspaceId, versionOptions, workspaces]);

  useEffect(() => {
    const requirementId = searchParams.get('launchRequirementId');
    if (!hasLoaded || !requirementId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('launchRequirementId');
    setSearchParams(nextParams, { replace: true });
    const target = requirements.find((item) => item.id === requirementId);
    if (target?.prototypeImport && target.prototypeImport.status !== 'CONFIRMED') {
      navigate(`/requirements/${target.id}`);
    } else if (target) {
      setLaunchModalRequirement(target);
      setLaunchRepositoryIds([]);
      setLaunchAiProvider(defaultAiProvider);
    } else {
      toast.error('未找到要启动的需求，请刷新后重试');
    }
  }, [hasLoaded, searchParams, requirements, defaultAiProvider, setSearchParams]);

  async function createRequirement(values: {
    projectId: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
    repositoryIds: string[];
    versionId: string;
  }) {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreateSubmitting(true);
    try {
      await api.createRequirement(values);
      setCreateDraft(emptyCreateDraft);
      setCreateModalOpen(false);
      const project = projects.find((item) => item.id === values.projectId);
      updateFilterQuery({ workspaceId: project?.workspace.id, projectId: values.projectId });
      await refresh();
      toast.success('需求创建成功');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建需求失败');
    } finally {
      createInFlight.current = false;
      setCreateSubmitting(false);
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

  async function handleCreateRequirement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createDraft.projectId) {
      toast.error('请选择项目');
      return;
    }

    if (!createDraft.versionId) {
      toast.error('请选择发布版本');
      return;
    }

    if (createMode === 'prototype') {
      if (prototypeInFlight.current) return;
      if (!prototypeFile || !/\.zip$/i.test(prototypeFile.name) || prototypeFile.size > 20 * 1024 * 1024) {
        setPrototypeError('请选择不超过 20 MiB 的 ZIP 文件');
        return;
      }
      prototypeInFlight.current = true;
      setPrototypeSubmitting(true);
      setPrototypeError(null);
      try {
        const imported = await api.createPrototypeImport({ projectId: createDraft.projectId, versionId: createDraft.versionId, goal: prototypeGoal.trim(), aiProvider: prototypeProvider }, prototypeFile);
        navigate(`/requirements/${imported.requirementId}?importing=1`);
      } catch (error) {
        setPrototypeError(error instanceof Error ? error.message : '上传原型失败，请重试');
      } finally {
        prototypeInFlight.current = false;
        setPrototypeSubmitting(false);
      }
      return;
    }

    if (!createDraft.title.trim()) {
      toast.error('请填写需求标题');
      return;
    }

    await createRequirement({
      projectId: createDraft.projectId,
      title: createDraft.title.trim(),
      description: createDraft.description.trim(),
      acceptanceCriteria: createDraft.acceptanceCriteria.trim(),
      repositoryIds: createDraft.repositoryIds,
      versionId: createDraft.versionId,
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

  function renderActiveWorkflowScope(requirement: Requirement) {
    const activeRuns = getActiveRequirementWorkflows(requirement);
    if (activeRuns.length === 0) {
      return '当前没有进行中的工作流。';
    }

    return activeRuns
      .map((run) => {
        return `${run.id.slice(-6)} · ${formatWorkflowStatus(run.status)} · ${formatRequirementWorkflowScope(run)}`;
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
              <div className="rounded-md border border-border bg-muted px-4 py-3">
                <div className="text-sm font-semibold text-foreground">{launchModalRequirement.title}</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  默认范围：{renderRepositoryScope(launchModalRequirement)}
                </div>
              </div>
              {getActiveRequirementWorkflows(launchModalRequirement).length > 0 ? (
                <div className="rounded-md border border-border p-3">
                  <p className="text-sm font-semibold">已有活跃工作流</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">下列仓库范围已被占用，可继续已有流程，或选择不同仓库并行启动。</p>
                  <ul className="mt-2 flex flex-col gap-2 text-sm">
                    {getActiveRequirementWorkflows(launchModalRequirement).map((run) => (
                      <li key={run.id}>
                        {formatWorkflowStatus(run.status)} · {formatRequirementWorkflowScope(run)}
                        {' · '}<Link className="text-primary hover:underline" to={`/workflow-runs/${run.id}`}>继续此工作流</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground">默认 AI 执行器</label>
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
                  <p className="text-xs leading-5 text-muted-foreground">
                    平台生成与开发执行使用此默认工具；AI 审查可在该阶段单独选择。
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-foreground">本次工作流仓库范围</label>
                  <span className="text-xs leading-5 text-muted-foreground">不选则按默认范围启动</span>
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
          if (prototypeInFlight.current || createInFlight.current) return;
          setCreateModalOpen(open);
          if (!open) {
            setCreateDraft(emptyCreateDraft);
            setCreateMode('manual'); setPrototypeFile(null); setPrototypeGoal(''); setPrototypeError(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" onEscapeKeyDown={(event) => { if (prototypeSubmitting || createSubmitting) event.preventDefault(); }} onPointerDownOutside={(event) => { if (prototypeSubmitting || createSubmitting) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>创建需求</DialogTitle>
            <DialogDescription>填写标题、选择版本即可创建；也可上传已有原型，由 AI 整理。</DialogDescription>
          </DialogHeader>
          <div role="tablist" aria-label="需求创建方式" className="flex gap-2">
            <UiButton role="tab" aria-selected={createMode === 'manual'} variant={createMode === 'manual' ? 'default' : 'outline'} disabled={prototypeSubmitting || createSubmitting} onClick={() => setCreateMode('manual')}>普通填写</UiButton>
            <UiButton role="tab" aria-selected={createMode === 'prototype'} variant={createMode === 'prototype' ? 'default' : 'outline'} disabled={prototypeSubmitting || createSubmitting} onClick={() => setCreateMode('prototype')}>已有原型</UiButton>
          </div>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreateRequirement(event)}>
            <fieldset disabled={prototypeSubmitting || createSubmitting} className="contents">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">所属项目</label>
              <Select
                value={createDraft.projectId || ''}
                onValueChange={(value) => {
                  const project = projects.find((item) => item.id === value);
                  setCreateDraft((current) => ({
                    ...current,
                    projectId: value,
                    repositoryIds: [],
                    versionId: project?.currentVersionId ?? '',
                  }));
                }}
              >
                <SelectTrigger aria-label="所属项目">
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
            {createDraft.projectId ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground">发布版本（必填）</label>
                <Select
                  key={createDraft.projectId}
                  value={createDraft.versionId}
                  onValueChange={(value) => setCreateDraft((current) => ({ ...current, versionId: value }))}
                >
                  <SelectTrigger aria-label="发布版本" aria-required="true">
                    <SelectValue placeholder="选择发布版本" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedProject?.versions ?? []).map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        {version.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!(selectedProject?.versions?.length) && <p className="text-sm text-muted-foreground">项目尚无发布版本，请先<Link className="text-primary underline" to={`/projects/${createDraft.projectId}`}>前往项目设置版本</Link>。</p>}
              </div>
            ) : null}
            {createMode === 'manual' && <>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-title">需求标题（必填）</label>
              <UiInput
                id="requirement-title"
                required
                value={createDraft.title}
                onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="AI研发调度系统 MVP"
              />
            </div>
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">补充信息（选填）</summary>
              <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-description">需求描述（选填）</label>
              <Textarea
                id="requirement-description"
                rows={4}
                value={createDraft.description}
                onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="描述产品目标、范围和约束边界。"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-acceptance">验收标准（选填）</label>
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
                <label className="text-sm font-semibold text-foreground">影响仓库范围</label>
                <span className="text-xs leading-5 text-muted-foreground">不选则默认继承项目工作区全部仓库</span>
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
                  <p className="text-sm leading-6 text-muted-foreground">当前项目所在工作区还没有可选仓库。</p>
                )
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">先选择项目，再指定这条需求实际影响的仓库。</p>
              )}
            </div>
              </div>
            </details>
            </>}
            {createMode === 'prototype' && <>
              <label className="flex flex-col gap-2 text-sm">原型 ZIP（最大 20 MiB）
                <UiInput type="file" accept=".zip,application/zip" aria-label="原型 ZIP" onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setPrototypeFile(file);
                  setPrototypeError(file && (!/\.zip$/i.test(file.name) || file.size > 20 * 1024 * 1024) ? '请选择不超过 20 MiB 的 ZIP 文件' : null);
                }} />
              </label>
              <p className="text-xs text-muted-foreground">上传 HTML 原型、图片、说明或源码。AI 自动整理需求与设计并接入研发流程，无需逐项确认。</p>
              <label className="flex flex-col gap-2 text-sm">一句话目标（可选）<Textarea aria-label="一句话目标" value={prototypeGoal} onChange={(event) => setPrototypeGoal(event.target.value)} /></label>
              <div className="flex flex-col gap-2 text-sm"><label>默认 AI 执行器</label><Select value={prototypeProvider} onValueChange={(value: 'codex' | 'cursor') => setPrototypeProvider(value)}><SelectTrigger aria-label="原型整理执行器"><SelectValue /></SelectTrigger><SelectContent>{availableAiProviders.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}</SelectContent></Select></div>
              {prototypeError && <p role="alert" className="text-sm text-danger">{prototypeError}</p>}
            </>}
            <UiButton type="submit" className="mt-2" disabled={prototypeSubmitting || createSubmitting}>
              {createMode === 'prototype' ? prototypeSubmitting ? '上传整理中…' : '上传原型，AI 整理' : createSubmitting ? '创建中…' : '创建需求'}
            </UiButton>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Requirements"
        title="需求"
        description="查看需求、确认门禁并启动工作流。本页可直接创建需求。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="需求总数" value={requirementSummary.requirementCount} />
        <MetricCard label="当前筛选结果" value={requirementSummary.visibleCount} />
        <MetricCard label="涉及工作区" value={requirementSummary.workspaceCount} />
        <MetricCard label="涉及项目" value={requirementSummary.projectCount} />
      </div>
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Requirement Pool"
            title="需求列表"
            extra={(
              <div className="flex flex-wrap items-center gap-2">
                <UiButton onClick={() => {
                  const project = projects.find((item) => item.id === selectedProjectId);
                  setCreateDraft({ ...emptyCreateDraft, projectId: project?.id ?? '', versionId: project?.currentVersionId ?? '' });
                  setPrototypeProvider(defaultAiProvider);
                  setCreateModalOpen(true);
                }}>
                  创建需求
                </UiButton>
              </div>
            )}
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <ListToolbar
            filters={(
              <>
                <Select
                  value={selectedWorkspaceId ?? ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilterQuery({ workspaceId: value === ALL_FILTER_VALUE ? undefined : value }, ['projectId', 'versionId'])}
                >
                  <SelectTrigger className="w-[220px]" aria-label="按工作区筛选">
                    <SelectValue placeholder="按工作区筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>全部工作区</SelectItem>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedProjectId ?? ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilterQuery({ projectId: value === ALL_FILTER_VALUE ? undefined : value }, ['versionId'])}
                >
                  <SelectTrigger className="w-[220px]" aria-label="按项目筛选">
                    <SelectValue placeholder="按项目筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>全部项目</SelectItem>
                    {filteredProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedVersionId ?? ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilterQuery({ versionId: value === ALL_FILTER_VALUE ? undefined : value })}
                >
                  <SelectTrigger className="w-[220px]" aria-label="按发布版本">
                    <SelectValue placeholder="按发布版本" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>全部版本</SelectItem>
                    {versionOptions.map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        {version.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedPlanningStatus ?? ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilterQuery({ planningStatus: value === ALL_FILTER_VALUE ? undefined : value })}
                >
                  <SelectTrigger className="w-[180px]" aria-label="按规划状态">
                    <SelectValue placeholder="按规划状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>全部规划状态</SelectItem>
                    {planningStatusOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedPriority ?? ALL_FILTER_VALUE}
                  onValueChange={(value) => updateFilterQuery({ priority: value === ALL_FILTER_VALUE ? undefined : value })}
                >
                  <SelectTrigger className="w-[160px]" aria-label="按优先级">
                    <SelectValue placeholder="按优先级" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER_VALUE}>全部优先级</SelectItem>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasActiveFilters ? (
                  <UiButton type="button" variant="outline" size="sm" onClick={clearFilters}>
                    清除筛选
                  </UiButton>
                ) : null}
              </>
            )}
          />
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredRequirements.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {filteredRequirements.map((item) => (
                <RecordListItem
                  key={item.id}
                  title={(
                    <Link
                      to={`/requirements/${item.id}`}
                      className="text-base font-semibold leading-6 text-foreground no-underline hover:text-primary"
                    >
                      {item.title}
                    </Link>
                  )}
                  interactive
                  badges={
                    <>
                      <Badge variant="secondary">{item.project.name}</Badge>
                      {item.version ? <Badge variant="outline">版本 {item.version.name}</Badge> : null}
                      <Badge variant="outline">{formatPlanningStatus(item.planningStatus)}</Badge>
                      <Badge variant="outline">{formatPriority(item.priority)}</Badge>
                      {item.prototypeImport && item.prototypeImport.status !== 'CONFIRMED' ? (
                        <Badge variant="warning">{item.prototypeImport.status === 'FAILED' ? '导入失败' : '原型导入中'}</Badge>
                      ) : null}
                    </>
                  }
                  actions={
                    <>
                      <UiButton variant="default" asChild>
                        <Link to={`/requirements/${item.id}`}>详情</Link>
                      </UiButton>
                      <UiButton variant="outline" asChild>
                        <Link to={`/requirements/${item.id}#scheduling`}>排期</Link>
                      </UiButton>
                      <UiButton
                        variant="outline"
                        onClick={() => {
                          if (item.prototypeImport && item.prototypeImport.status !== 'CONFIRMED') {
                            navigate(`/requirements/${item.id}`);
                            return;
                          }
                          setLaunchModalRequirement(item);
                          setLaunchRepositoryIds([]);
                        }}
                      >
                        {item.prototypeImport && item.prototypeImport.status !== 'CONFIRMED' ? '查看导入' : '启动工作流'}
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
            <EmptyState description={hasActiveFilters ? '当前筛选条件下没有需求，请调整筛选或清除条件' : '还没有录入任何需求，先创建一条需求开始推进。'} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
