import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useListPage } from '../hooks/use-list-page';
import { ListPagination } from '../components/ListPagination';
import { PagedSelect } from '../components/PagedSelect';
import { useConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ProjectRequiredState } from '../components/ProjectRequiredState';
import { RequirementEditDialog } from '../components/RequirementEditDialog';
import { ListToolbar } from '../components/ListToolbar';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
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
import type { PageQuery, PageResult, Project, ProjectVersionSummary, Repository, Requirement } from '../types';
import { formatPlanningStatus, formatPriority } from '../utils/label-utils';
import { useScopedProjectId } from '../project-scope-context';
import { useRememberedSearchFilters } from '../utils/list-filter-storage';
import { formatRequirementWorkflowScope } from '../utils/requirement-workflows';
import { formatWorkflowStatus } from '../utils/workflow-ui';
import { normalizeOnlineAiProviders, ONLINE_AI_UNAVAILABLE_MESSAGE } from '../online-ai';

const emptyCreateDraft = {
  projectId: '',
  title: '',
  priority: 'MEDIUM',
  description: '',
  acceptanceCriteria: '',
  functionalModule: '',
  riskImpact: '',
  productRequirementDocument: '',
  remark: '',
  repositoryIds: [] as string[],
  versionId: '',
};

const ALL_FILTER_VALUE = '__all__';
const REQUIREMENT_PAGE_SIZE = 20;

const planningStatusOptions = [
  { id: 'UNSCHEDULED', label: '未排期' },
  { id: 'SCHEDULED', label: '已排期' },
  { id: 'IN_PROGRESS', label: '进行中' },
  { id: 'DONE', label: '已完成' },
] as const;

function formatRequirementCreatedAt(value?: string | null) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

const priorityOptions = [
  { id: 'URGENT', label: '紧急' },
  { id: 'HIGH', label: '高' },
  { id: 'MEDIUM', label: '中' },
  { id: 'LOW', label: '低' },
] as const;

function RepositoryChoices({ scopeKey, selectedIds, onToggle, loadPage }: {
  scopeKey: string; selectedIds: string[]; onToggle: (id: string) => void;
  loadPage: (query: PageQuery) => Promise<PageResult<Repository>>;
}) {
  const [items, setItems] = useState<Repository[]>([]);
  const [page, setPage] = useState(1); const [q, setQ] = useState('');
  const [total, setTotal] = useState(0); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const load = useRef(loadPage); load.current = loadPage;
  useEffect(() => { setPage(1); setQ(''); setItems([]); }, [scopeKey]);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void load.current({ page, pageSize: 20, q: q.trim() || undefined }).then(result => {
        if (!cancelled) { setItems(result.items); setTotal(result.total); }
      }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : '加载仓库失败'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [page, q, scopeKey, retry]);
  return <div className="flex flex-col gap-2">
    <UiInput aria-label="仓库搜索" placeholder="搜索仓库" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} />
    <p className="text-xs text-muted-foreground">已选 {selectedIds.length} 个仓库</p>
    {error ? <p role="alert">{error}<UiButton type="button" size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>重试</UiButton></p> : null}
    <div className="flex flex-wrap gap-2">{items.map(repository => <UiButton key={repository.id} type="button" size="sm" variant={selectedIds.includes(repository.id) ? 'default' : 'outline'} onClick={() => onToggle(repository.id)}>{selectedIds.includes(repository.id) ? '已选' : '选择'} {repository.name}</UiButton>)}</div>
    {!loading && !error && !items.length ? <p className="text-sm text-muted-foreground">当前范围没有可选仓库。</p> : null}
    <ListPagination page={page} total={total} loading={loading} onPageChange={setPage} label="仓库分页" />
  </div>;
}

function ActiveWorkflows({requirementId}:{requirementId:string}) {
  const list = useListPage(api.getWorkflowRuns, {requirementId,activeOnly:true,excludeSuperseded:true}, {pageKey:'activePage'});
  if (!list.loading && !list.error && !list.total) return null;
  return <div className="rounded-md border border-border p-3">
    <p className="text-sm font-semibold">已有活跃工作流</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">下列仓库范围已被占用，可继续已有流程，或选择不同仓库并行启动。</p>
    {list.error ? <p role="alert">{list.error}<UiButton variant="outline" size="sm" onClick={list.refresh}>重试</UiButton></p> : null}
    <ul className="mt-2 flex flex-col gap-2 text-sm">{list.items.map(run => <li key={run.id}>{formatWorkflowStatus(run.status)} · {formatRequirementWorkflowScope(run)}{' · '}<Link className="text-primary hover:underline" to={`/workflow-runs/${run.id}`}>继续此工作流</Link></li>)}</ul>
    <ListPagination page={list.page} total={list.total} loading={list.loading} onPageChange={list.onPageChange} label="活跃工作流分页" />
  </div>;
}

export function RequirementsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberedSearchFilters('requirements', ['versionId', 'planningStatus', 'priority']);
  const [scopedProject, setScopedProject] = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [filterVersion, setFilterVersion] = useState<ProjectVersionSummary | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<Requirement | null>(null);
  const [deletingRequirementId, setDeletingRequirementId] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const createInFlight = useRef(false);
  const createProjectEpoch = useRef(0);
  const [launchModalRequirement, setLaunchModalRequirement] = useState<Requirement | null>(null);
  const [launchRepositoryIds, setLaunchRepositoryIds] = useState<string[]>([]);
  const [launchAiProvider, setLaunchAiProvider] = useState<'codex' | 'cursor' | null>(null);
  const [defaultAiProvider, setDefaultAiProvider] = useState<'codex' | 'cursor' | null>(null);
  const [onlineAiAvailable, setOnlineAiAvailable] = useState(false);
  const [availableAiProviders, setAvailableAiProviders] = useState<Array<{ id: 'codex' | 'cursor'; label: string }>>([]);
  const [launchSubmitting, setLaunchSubmitting] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyCreateDraft);
  const [createMode, setCreateMode] = useState<'manual' | 'prototype'>('manual');
  const [prototypeFile, setPrototypeFile] = useState<File | null>(null);
  const [prototypeGoal, setPrototypeGoal] = useState('');
  const [prototypeProvider, setPrototypeProvider] = useState<'codex' | 'cursor' | null>(null);
  const [prototypeError, setPrototypeError] = useState<string | null>(null);
  const [prototypeSubmitting, setPrototypeSubmitting] = useState(false);
  const prototypeInFlight = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();
  const selectedProjectId = useScopedProjectId() || undefined;
  const selectedVersionId = searchParams.get('versionId') ?? undefined;
  const selectedPlanningStatus = searchParams.get('planningStatus') ?? undefined;
  const selectedPriority = searchParams.get('priority') ?? undefined;
  const hasActiveFilters = Boolean(
    selectedVersionId || selectedPlanningStatus || selectedPriority,
  );
  const list = useListPage(api.getRequirements, { projectId: selectedProjectId, versionId: selectedVersionId, planningStatus: selectedPlanningStatus, priority: selectedPriority }, {enabled: Boolean(selectedProjectId)});
  const {items: requirements, total, page, loading, refresh, onPageChange: setPage} = list;
  const hasLoaded = !loading;
  const requirementSummary = {requirementCount:list.summary?.requirementCount ?? total,visibleCount:list.summary?.visibleCount ?? total,workspaceCount:list.summary?.workspaceCount ?? 0,projectCount:list.summary?.projectCount ?? 0};

  async function chooseCreateProject(id: string) {
    const epoch = ++createProjectEpoch.current;
    setCreateDraft(current => ({ ...current, projectId: id, repositoryIds: [], versionId: '' }));
    setSelectedProject(null);
    try {
      const project = await api.getProject(id);
      if (epoch !== createProjectEpoch.current) return;
      setSelectedProject(project);
      setCreateDraft(current => current.projectId === id ? { ...current, versionId: project.currentVersionId ?? '' } : current);
    } catch (error) { toast.error(error instanceof Error ? error.message : '加载项目失败'); }
  }

  async function handleDeleteRequirement(item: Requirement) {
    const confirmed = await confirm({
      title: '删除需求',
      description: `删除后将移除「${item.title}」及其工作流、构思记录、排期和原型材料。关联的缺陷与问题会保留，但不再指向这条需求。已纳入测试设计或提测时需要先解除关联。确认删除吗？`,
      confirmLabel: '删除需求',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    setDeletingRequirementId(item.id);
    try {
      await api.deleteRequirement(item.id);
      toast.success('需求已删除');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除需求失败');
    } finally {
      setDeletingRequirementId(null);
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
    ['workspaceId', 'versionId', 'planningStatus', 'priority'].forEach((key) => nextParams.delete(key));
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    let cancelled = false; setScopedProject(null);
    if (selectedProjectId) void api.getProject(selectedProjectId).then(project => { if (!cancelled) setScopedProject(project); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProjectId]);
  useEffect(() => {
    let cancelled = false; setFilterVersion(null);
    if (selectedProjectId && selectedVersionId) void api.getProjectVersion(selectedProjectId, selectedVersionId).then(version => { if (!cancelled) setFilterVersion(version); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedProjectId, selectedVersionId]);
  useEffect(() => {
    let cancelled = false;
    void api.getWorkflowProviders().then(config => {
      if (cancelled) return; const policy = normalizeOnlineAiProviders(config);
      setAvailableAiProviders(policy.providers); setOnlineAiAvailable(policy.onlineAvailable); setDefaultAiProvider(policy.defaultProvider); setLaunchAiProvider(policy.defaultProvider); setPrototypeProvider(policy.defaultProvider);
    }).catch(error => { if (!cancelled) toast.error(error instanceof Error ? error.message : '加载执行器失败'); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!hasLoaded) return;
    const invalidKeys = [searchParams.has('workspaceId') ? 'workspaceId' : null,
      selectedPlanningStatus && !planningStatusOptions.some(option => option.id === selectedPlanningStatus) ? 'planningStatus' : null,
      selectedPriority && !priorityOptions.some(option => option.id === selectedPriority) ? 'priority' : null,
    ].filter((key): key is string => Boolean(key));
    if (invalidKeys.length) { const next = new URLSearchParams(searchParams); invalidKeys.forEach(key => next.delete(key)); setSearchParams(next, {replace:true}); }
  }, [hasLoaded, searchParams, selectedPlanningStatus, selectedPriority]);
  const launchRequestId = searchParams.get('launchRequirementId');
  useEffect(() => {
    if (!hasLoaded || !launchRequestId) return;
    const next = new URLSearchParams(searchParams); next.delete('launchRequirementId'); setSearchParams(next, {replace:true});
    // 深链目标可能不在当前页，始终按ID解析完整详情。
    void api.getRequirement(launchRequestId).then(target => {
      if (target.prototypeImport && target.prototypeImport.status !== 'CONFIRMED') { navigate(`/requirements/${target.id}`); return; }
      setLaunchModalRequirement(target); setLaunchRepositoryIds([]); setLaunchAiProvider(defaultAiProvider);
    }).catch(error => toast.error(error instanceof Error ? error.message : '未找到要启动的需求，请刷新后重试'));
  }, [hasLoaded, launchRequestId]);

  async function createRequirement(values: {
    projectId: string;
    title: string;
    priority: string;
    description: string;
    acceptanceCriteria: string;
    functionalModule: string;
    riskImpact: string;
    productRequirementDocument: string;
    remark: string;
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
      updateFilterQuery({ projectId: values.projectId });
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
    if (!launchAiProvider) {
      toast.error(ONLINE_AI_UNAVAILABLE_MESSAGE);
      return;
    }
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
      if (!onlineAiAvailable || !prototypeProvider) {
        setPrototypeError(ONLINE_AI_UNAVAILABLE_MESSAGE);
        return;
      }
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
      priority: createDraft.priority,
      description: createDraft.description.trim(),
      acceptanceCriteria: createDraft.acceptanceCriteria.trim(),
      functionalModule: createDraft.functionalModule.trim(),
      riskImpact: createDraft.riskImpact.trim(),
      productRequirementDocument: createDraft.productRequirementDocument.trim(),
      remark: createDraft.remark.trim(),
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
    const count = requirement._count?.requirementRepositories ?? repositories.length;
    if (count === 0) {
      return '未单独指定仓库范围，将继承项目工作区的默认仓库上下文。';
    }
    if (!repositories.length) return `已指定 ${count} 个仓库，可在启动时分页查看范围。`;
    const names = repositories.map((repository) => repository.name).join('、');
    return count > repositories.length ? `${names} 等 ${count} 个仓库` : names;
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
              <ActiveWorkflows requirementId={launchModalRequirement.id} />
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground">默认 AI 执行器</label>
                  <Select
                    value={launchAiProvider ?? undefined}
                    onValueChange={(value: 'codex' | 'cursor') => setLaunchAiProvider(value)}
                    disabled={!onlineAiAvailable}
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
                    {onlineAiAvailable
                      ? '默认使用组织优先的在线 AI。平台生成与开发执行使用此工具；AI 审查可在该阶段单独选择。'
                      : ONLINE_AI_UNAVAILABLE_MESSAGE}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-foreground">本次工作流仓库范围</label>
                  <span className="text-xs leading-5 text-muted-foreground">不选则按默认范围启动</span>
                </div>
                <RepositoryChoices scopeKey={launchModalRequirement.id} selectedIds={launchRepositoryIds} onToggle={toggleLaunchRepository}
                  loadPage={query => ((launchModalRequirement._count?.requirementRepositories ?? launchModalRequirement.requirementRepositories?.length ?? 0) > 0
                    ? api.getRequirementRepositories(launchModalRequirement.id, query)
                    : api.getWorkspaceRepositories(launchModalRequirement.project.workspace.id, { ...query, status: 'ACTIVE' }))} />
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
                  disabled={launchSubmitting || !onlineAiAvailable || !launchAiProvider}
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
              <PagedSelect value={createDraft.projectId} selectedLabel={selectedProject?.id === createDraft.projectId ? selectedProject.name : undefined} label="所属项目" placeholder="选择需求归属的项目" loadPage={query => api.getProjects(query)} onValueChange={id => void chooseCreateProject(id)} />
            </div>
            {createDraft.projectId ? (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground">发布版本（必填）</label>
                <PagedSelect scopeKey={createDraft.projectId} value={createDraft.versionId} selectedLabel={selectedProject?.currentVersion?.id === createDraft.versionId ? selectedProject.currentVersion.name : undefined} label="发布版本" placeholder="选择发布版本" loadPage={query => api.listProjectVersions(createDraft.projectId, query)} onValueChange={value => setCreateDraft(current => ({...current, versionId:value}))} />
                {selectedProject?._count?.versions === 0 && <p className="text-sm text-muted-foreground">项目尚无发布版本，请先<Link className="text-primary underline" to={`/project-settings?projectId=${createDraft.projectId}`}>前往项目设置版本</Link>。</p>}
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
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">优先级（必填）</label>
              <Select
                value={createDraft.priority}
                onValueChange={(value) => setCreateDraft((current) => ({ ...current, priority: value }))}
              >
                <SelectTrigger aria-label="优先级" aria-required="true">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-module">功能模块（选填）</label>
              <UiInput
                id="requirement-module"
                value={createDraft.functionalModule}
                onChange={(event) => setCreateDraft((current) => ({ ...current, functionalModule: event.target.value }))}
                placeholder="例如：登录"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-risk">风险&影响（选填）</label>
              <Textarea
                id="requirement-risk"
                rows={3}
                value={createDraft.riskImpact}
                onChange={(event) => setCreateDraft((current) => ({ ...current, riskImpact: event.target.value }))}
                placeholder="说明业务影响和波及范围。"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-prd">产品需求文档（选填）</label>
              <Textarea
                id="requirement-prd"
                rows={3}
                value={createDraft.productRequirementDocument}
                onChange={(event) => setCreateDraft((current) => ({ ...current, productRequirementDocument: event.target.value }))}
                placeholder="粘贴文档链接或摘要。"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor="requirement-remark">备注（选填）</label>
              <Textarea
                id="requirement-remark"
                rows={3}
                value={createDraft.remark}
                onChange={(event) => setCreateDraft((current) => ({ ...current, remark: event.target.value }))}
                placeholder="内部协同备忘，不进入研发上下文。"
              />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-semibold text-foreground">影响仓库范围</label>
                <span className="text-xs leading-5 text-muted-foreground">不选则默认继承项目工作区全部仓库</span>
              </div>
              {selectedProject ? (
                <RepositoryChoices scopeKey={selectedProject?.workspace.id ?? createDraft.projectId} selectedIds={createDraft.repositoryIds} onToggle={toggleRepository}
                  loadPage={query => api.getWorkspaceRepositories(selectedProject!.workspace.id, {...query, status:'ACTIVE'})} />
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
              <div className="flex flex-col gap-2 text-sm"><label>默认 AI 执行器</label>{onlineAiAvailable ? <Select value={prototypeProvider ?? undefined} onValueChange={(value: 'codex' | 'cursor') => setPrototypeProvider(value)}><SelectTrigger aria-label="原型整理执行器"><SelectValue /></SelectTrigger><SelectContent>{availableAiProviders.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>)}</SelectContent></Select> : <p role="status" className="text-sm leading-6 text-muted-foreground">{ONLINE_AI_UNAVAILABLE_MESSAGE}</p>}</div>
              {prototypeError && <p role="alert" className="text-sm text-danger">{prototypeError}</p>}
            </>}
            <UiButton type="submit" className="mt-2" disabled={prototypeSubmitting || createSubmitting || (createMode === 'prototype' && !onlineAiAvailable)}>
              {createMode === 'prototype' ? prototypeSubmitting ? '上传整理中…' : '上传原型，AI 整理' : createSubmitting ? '创建中…' : '创建需求'}
            </UiButton>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
      {editingRequirement ? (
        <RequirementEditDialog
          requirement={editingRequirement}
          open
          onOpenChange={(open) => { if (!open) setEditingRequirement(null); }}
          onSaved={() => {
            void refresh();
            setEditingRequirement(null);
            toast.success('需求已更新');
          }}
        />
      ) : null}
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
                  const project = scopedProject;
                  setSelectedProject(project);
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
                <PagedSelect className="w-[220px]" value={selectedVersionId ?? ''} selectedLabel={filterVersion && filterVersion.id === selectedVersionId ? filterVersion.name : undefined} label="按发布版本" placeholder="按发布版本" allowClear emptyLabel="全部版本" disabled={!selectedProjectId} scopeKey={selectedProjectId ?? ''}
                  loadPage={query => api.listProjectVersions(selectedProjectId!, query)} onValueChange={value => updateFilterQuery({versionId: value || undefined})} />
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
          {list.error ? <p role="alert" className="mb-3 text-sm text-danger">{list.error}<UiButton variant="outline" size="sm" onClick={refresh}>重试</UiButton></p> : null}
          {!selectedProjectId ? (
            <ProjectRequiredState />
          ) : loading && requirements.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : requirements.length > 0 ? (
            <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-max min-w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    {['需求标题', '需求描述', '优先级', '创建人', '创建时间', '需求变更时间', '最新变更内容', '备注', '操作'].map((label) => (
                      <th
                        key={label}
                        className={label === '操作'
                          ? 'sticky right-0 z-20 whitespace-nowrap border-l border-border bg-muted px-4 py-3 font-medium'
                          : 'whitespace-nowrap px-4 py-3 font-medium'}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requirements.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <Link to={`/requirements/${item.id}`} className="text-foreground no-underline hover:text-primary">{item.title}</Link>
                          {item.prototypeImport && item.prototypeImport.status !== 'CONFIRMED' ? (
                            <Badge variant="warning">{item.prototypeImport.status === 'FAILED' ? '导入失败' : '原型导入中'}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description.trim() || '未填写'}</td>
                      <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{item.createdByName?.trim() || '未记录'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground"><time dateTime={item.createdAt ?? undefined}>{formatRequirementCreatedAt(item.createdAt)}</time></td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.latestChangeAt ? <time dateTime={item.latestChangeAt}>{formatRequirementCreatedAt(item.latestChangeAt)}</time> : '—'}</td>
                      <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.latestChangeContent?.trim() || '—'}</td>
                      <td className="max-w-xs whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.remark?.trim() || '未填写'}</td>
                      <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3">
                        <div className="flex flex-nowrap gap-2">
                          <UiButton variant="default" size="sm" asChild>
                            <Link to={`/requirements/${item.id}`}>详情</Link>
                          </UiButton>
                          <UiButton variant="outline" size="sm" type="button" onClick={() => setEditingRequirement(item)}>
                            编辑
                          </UiButton>
                          <UiButton
                            variant="outline"
                            size="sm"
                            type="button"
                            aria-label={`删除需求：${item.title}`}
                            disabled={deletingRequirementId === item.id}
                            onClick={() => void handleDeleteRequirement(item)}
                          >
                            {deletingRequirementId === item.id ? '删除中...' : '删除'}
                          </UiButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ListPagination page={page} total={total} pageSize={REQUIREMENT_PAGE_SIZE} loading={loading} onPageChange={setPage} label="需求列表分页" />
            </>
          ) : (
            <EmptyState description={hasActiveFilters ? '当前筛选条件下没有需求，请调整筛选或清除条件' : '还没有录入任何需求，先创建一条需求开始推进。'} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
