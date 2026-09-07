import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClipboardCheck, Library, PlayCircle, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import type {
  Project,
  TestCaseDefinition,
  TestCaseLibrary,
  TestRequest,
  WorkflowRun,
  Workspace,
} from '../types';

const requestStatusLabels: Record<string, string> = {
  DRAFT: '范围生成中',
  READY: '待执行',
  IN_TEST: '执行中',
  PASSED: '已通过',
  FAILED: '未通过',
  BLOCKED: '已阻塞',
  CANCELLED: '已取消',
};

const runStatusLabels: Record<string, string> = {
  ACTIVE: '执行中',
  PASSED: '已通过',
  FAILED: '未通过',
  BLOCKED: '已阻塞',
};

type QualityTab = 'requests' | 'cases' | 'runs';

export function QualityPage() {
  const toast = useToast();
  const [tab, setTab] = useState<QualityTab>('requests');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [requests, setRequests] = useState<TestRequest[]>([]);
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
  const [cases, setCases] = useState<TestCaseDefinition[]>([]);
  const [projectFilter, setProjectFilter] = useState('__all__');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [caseWorkspaceId, setCaseWorkspaceId] = useState('');
  const [caseProjectId, setCaseProjectId] = useState('__shared__');
  const [libraryFilter, setLibraryFilter] = useState('__all__');
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [showLibraryDialog, setShowLibraryDialog] = useState(false);
  const [showCaseDialog, setShowCaseDialog] = useState(false);

  async function refreshCore(silent = false) {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [workspaceList, projectList, workflowList, requestList] =
        await Promise.all([
          api.getWorkspaces(),
          api.getProjects(),
          api.getWorkflowRuns(),
          api.getTestRequests(),
        ]);
      setWorkspaces(workspaceList);
      setProjects(projectList);
      setWorkflowRuns(workflowList);
      setRequests(requestList);
      setCaseWorkspaceId((current) => current || workspaceList[0]?.id || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载测试与质量数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshCore();
  }, []);

  useEffect(() => {
    if (!caseWorkspaceId) {
      setLibraries([]);
      setCases([]);
      return;
    }
    let cancelled = false;
    const projectId = caseProjectId === '__shared__' ? undefined : caseProjectId;
    Promise.all([
      api.getTestCaseLibraries({ workspaceId: caseWorkspaceId, projectId }),
      api.getTestCases({ workspaceId: caseWorkspaceId, projectId }),
    ])
      .then(([libraryList, caseList]) => {
        if (!cancelled) {
          setLibraries(libraryList);
          setCases(caseList);
          setLibraryFilter('__all__');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '加载用例库失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [caseProjectId, caseWorkspaceId]);

  const filteredRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          (projectFilter === '__all__' || request.projectId === projectFilter) &&
          (statusFilter === '__all__' || request.status === statusFilter),
      ),
    [projectFilter, requests, statusFilter],
  );

  const filteredCases = useMemo(
    () => cases.filter((item) => libraryFilter === '__all__' || item.libraryId === libraryFilter),
    [cases, libraryFilter],
  );

  const runRows = useMemo(
    () =>
      requests.flatMap((request) =>
        (request.testPlan?.runs ?? []).map((run) => ({ request, run })),
      ),
    [requests],
  );

  const activeCount = requests.filter((item) =>
    ['DRAFT', 'READY', 'IN_TEST'].includes(item.status),
  ).length;
  const passedCount = requests.filter((item) => item.status === 'PASSED').length;
  const regressionCount = runRows.filter((item) => item.run.runType === 'REGRESSION').length;
  const projectsInWorkspace = projects.filter((project) => project.workspace.id === caseWorkspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Quality Center"
        title="测试与质量"
        description="围绕项目版本管理提测范围、用例快照、执行轮次和 Bug 回归。"
        icon={ShieldCheck}
        actions={(
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="刷新"
            aria-label="刷新"
            disabled={refreshing}
            onClick={() => void refreshCore(true)}
          >
            <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="提测总数" value={requests.length} />
        <MetricCard label="进行中" value={activeCount} />
        <MetricCard label="已通过" value={passedCount} />
        <MetricCard label="回归轮次" value={regressionCount} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as QualityTab)}>
        <TabsList className="max-w-2xl">
          <TabsTrigger value="requests"><ClipboardCheck className="mr-2 h-4 w-4" />提测管理</TabsTrigger>
          <TabsTrigger value="cases"><Library className="mr-2 h-4 w-4" />用例库</TabsTrigger>
          <TabsTrigger value="runs"><PlayCircle className="mr-2 h-4 w-4" />执行记录</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部项目</SelectItem>
                  {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部状态</SelectItem>
                  {Object.entries(requestStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setShowRequestDialog(true)}><Plus className="mr-2 h-4 w-4" />发起提测</Button>
          </div>
          {loading ? <LoadingState /> : filteredRequests.length ? (
            <div className="space-y-3">
              {filteredRequests.map((request) => <RequestRow key={request.id} request={request} />)}
            </div>
          ) : (
            <EmptyState title="暂无提测记录" description="当前筛选范围内没有提测记录。" />
          )}
        </TabsContent>

        <TabsContent value="cases">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              <Select
                value={caseWorkspaceId}
                onValueChange={(value) => {
                  setCaseWorkspaceId(value);
                  setCaseProjectId('__shared__');
                }}
              >
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="选择工作区" /></SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={caseProjectId} onValueChange={setCaseProjectId}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__shared__">Workspace 共享库</SelectItem>
                  {projectsInWorkspace.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={libraryFilter} onValueChange={setLibraryFilter}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部用例库</SelectItem>
                  {libraries.map((library) => <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowLibraryDialog(true)} disabled={!caseWorkspaceId}>
                <Plus className="mr-2 h-4 w-4" />新建用例库
              </Button>
              <Button onClick={() => setShowCaseDialog(true)} disabled={!libraries.length}>
                <Plus className="mr-2 h-4 w-4" />新建用例
              </Button>
            </div>
          </div>
          {filteredCases.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {filteredCases.map((testCase) => <CaseRow key={testCase.id} testCase={testCase} />)}
            </div>
          ) : (
            <EmptyState title="暂无测试用例" description="当前用例库还没有可用用例。" />
          )}
        </TabsContent>

        <TabsContent value="runs">
          {loading ? <LoadingState /> : runRows.length ? (
            <div className="space-y-3">
              {runRows.map(({ request, run }) => (
                <Card key={run.id} className="rounded-md shadow-none">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{run.name}</span>
                        <Badge variant="outline">{run.runType === 'REGRESSION' ? 'Bug 回归' : '初测'}</Badge>
                        <Badge variant={run.status === 'PASSED' ? 'default' : 'secondary'}>
                          {runStatusLabels[run.status] ?? run.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {request.project.name} / {request.projectVersion.name} / {request.title}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{formatDate(run.startedAt)}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无执行记录" description="提测范围就绪并开始执行后，轮次会显示在这里。" />
          )}
        </TabsContent>
      </Tabs>

      <CreateRequestDialog
        open={showRequestDialog}
        onOpenChange={setShowRequestDialog}
        projects={projects}
        workflowRuns={workflowRuns}
        onCreated={async () => {
          setShowRequestDialog(false);
          await refreshCore(true);
        }}
      />
      <CreateLibraryDialog
        open={showLibraryDialog}
        onOpenChange={setShowLibraryDialog}
        workspaceId={caseWorkspaceId}
        projectId={caseProjectId === '__shared__' ? undefined : caseProjectId}
        onCreated={async () => {
          setShowLibraryDialog(false);
          const projectId = caseProjectId === '__shared__' ? undefined : caseProjectId;
          setLibraries(await api.getTestCaseLibraries({ workspaceId: caseWorkspaceId, projectId }));
        }}
      />
      <CreateCaseDialog
        open={showCaseDialog}
        onOpenChange={setShowCaseDialog}
        libraries={libraries}
        onCreated={async () => {
          setShowCaseDialog(false);
          const projectId = caseProjectId === '__shared__' ? undefined : caseProjectId;
          setCases(await api.getTestCases({ workspaceId: caseWorkspaceId, projectId }));
        }}
      />
    </>
  );
}

function RequestRow({ request }: { request: TestRequest }) {
  return (
    <Card className="rounded-md shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{request.title}</span>
            <Badge variant={request.status === 'PASSED' ? 'default' : 'secondary'}>
              {requestStatusLabels[request.status] ?? request.status}
            </Badge>
            <Badge variant="outline">{request.projectVersion.name}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{request.project.name}</span>
            <span>{request.requirementLinks.length} 个需求</span>
            <span>{request.testPlan?.snapshots.length ?? 0} 个范围用例</span>
            <span>{request.testPlan?.runs.length ?? 0} 个执行轮次</span>
          </div>
          {request.scopeSummary ? <p className="max-w-4xl text-sm text-muted-foreground">{request.scopeSummary}</p> : null}
        </div>
        <span className="text-sm text-muted-foreground">{formatDate(request.createdAt)}</span>
      </CardContent>
    </Card>
  );
}

function CaseRow({ testCase }: { testCase: TestCaseDefinition }) {
  return (
    <Card className="rounded-md shadow-none">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{testCase.title}</span>
              <Badge variant="outline">{testCase.priority}</Badge>
              <Badge variant="secondary">v{testCase.version}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {testCase.library?.name ?? '用例库'}{testCase.module?.name ? ` / ${testCase.module.name}` : ''}
            </p>
          </div>
        </div>
        <div className="mt-3 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">预期：</span>{testCase.expected}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateRequestDialog({
  open,
  onOpenChange,
  projects,
  workflowRuns,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  workflowRuns: WorkflowRun[];
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const project = projects.find((item) => item.id === projectId);
  const eligibleRuns = workflowRuns.filter(
    (run) =>
      run.status.toUpperCase() === 'DONE' &&
      run.requirement.project.id === projectId &&
      run.requirement.versionId === versionId,
  );

  async function submit() {
    if (!project || !versionId || !title.trim() || !selectedRunIds.length) {
      toast.error('请选择项目版本、提测工作流并填写标题');
      return;
    }
    const selectedRuns = eligibleRuns.filter((run) => selectedRunIds.includes(run.id));
    const requirementIds = [...new Set(selectedRuns.map((run) => run.requirement.id))];
    setSaving(true);
    try {
      await api.createTestRequest({
        workspaceId: project.workspace.id,
        projectId,
        projectVersionId: versionId,
        title: title.trim(),
        description: description.trim() || undefined,
        requirementIds,
        workflowRunIds: selectedRunIds,
      });
      setTitle('');
      setDescription('');
      setSelectedRunIds([]);
      toast.success('提测草稿已创建');
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建提测失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>发起提测</DialogTitle>
          <DialogDescription>关联已完成的研发工作流，创建 AI 测试范围草稿。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="项目">
              <Select value={projectId} onValueChange={(value) => { setProjectId(value); setVersionId(''); setSelectedRunIds([]); }}>
                <SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger>
                <SelectContent>{projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="项目版本">
              <Select value={versionId} onValueChange={(value) => { setVersionId(value); setSelectedRunIds([]); }} disabled={!project}>
                <SelectTrigger><SelectValue placeholder="选择版本" /></SelectTrigger>
                <SelectContent>{(project?.versions ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="提测标题"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：2.6.0 登录能力提测" /></Field>
          <Field label="说明（可选）"><Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field label="已完成研发工作流">
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {eligibleRuns.length ? eligibleRuns.map((run) => (
                <label key={run.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={selectedRunIds.includes(run.id)}
                    onChange={(event) => setSelectedRunIds((current) =>
                      event.target.checked ? [...current, run.id] : current.filter((id) => id !== run.id),
                    )}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">{run.requirement.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{run.id}</span>
                  </span>
                </label>
              )) : <p className="px-2 py-6 text-center text-sm text-muted-foreground">该版本暂无已完成研发工作流</p>}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving} onClick={() => void submit()}>{saving ? '创建中…' : '创建提测草稿'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateLibraryDialog({ open, onOpenChange, workspaceId, projectId, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId?: string;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createTestCaseLibrary({ workspaceId, projectId, name: name.trim() });
      setName('');
      toast.success('用例库已创建');
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建用例库失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>新建用例库</DialogTitle><DialogDescription>{projectId ? '项目专属用例库' : 'Workspace 共享用例库'}</DialogDescription></DialogHeader>
        <Field label="名称"><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={saving || !name.trim()} onClick={() => void submit()}>创建</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateCaseDialog({ open, onOpenChange, libraries, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: TestCaseLibrary[];
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [libraryId, setLibraryId] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [precondition, setPrecondition] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && !libraryId) setLibraryId(libraries[0]?.id ?? '');
  }, [libraries, libraryId, open]);
  async function submit() {
    const stepList = steps.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!libraryId || !title.trim() || !stepList.length || !expected.trim()) {
      toast.error('请完整填写用例标题、步骤和预期结果');
      return;
    }
    setSaving(true);
    try {
      await api.createTestCase(libraryId, {
        title: title.trim(), priority, precondition: precondition.trim() || undefined,
        steps: stepList, expected: expected.trim(),
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setTitle(''); setPrecondition(''); setSteps(''); setExpected(''); setTags('');
      toast.success('测试用例已创建');
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建测试用例失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>新建测试用例</DialogTitle><DialogDescription>用例进入提测范围后会冻结为独立快照。</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="用例库"><Select value={libraryId} onValueChange={setLibraryId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{libraries.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="优先级"><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['P0', 'P1', 'P2', 'P3'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
          </div>
          <Field label="标题"><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="前置条件（可选）"><Input value={precondition} onChange={(event) => setPrecondition(event.target.value)} /></Field>
          <Field label="执行步骤"><Textarea rows={4} placeholder="每行一个步骤" value={steps} onChange={(event) => setSteps(event.target.value)} /></Field>
          <Field label="预期结果"><Textarea rows={2} value={expected} onChange={(event) => setExpected(event.target.value)} /></Field>
          <Field label="标签（可选）"><Input placeholder="使用英文逗号分隔" value={tags} onChange={(event) => setTags(event.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={saving} onClick={() => void submit()}>{saving ? '创建中…' : '创建用例'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium text-foreground"><span>{label}</span>{children}</label>;
}

function LoadingState() {
  return <div className="flex min-h-48 items-center justify-center"><Spinner className="h-7 w-7" /></div>;
}

function formatDate(value?: string | null) {
  if (!value) return '尚未开始';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
