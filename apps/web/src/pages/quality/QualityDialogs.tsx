import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QualityTargetKeysField } from './QualityTargetKeysField';
import { api } from '../../api';
import { PagedSelect } from '../../components/PagedSelect';
import { ListPagination } from '../../components/ListPagination';
import { useQualityPage } from './use-quality-page';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { useToast } from '../../components/ui/toast';
import type { Project, TestCaseLibrary, WorkflowRun } from '../../types';
import { Field } from './quality-ui';

const NO_MODULE = '__none__';

export function CreateRequestDialog({
  open,
  onOpenChange,
  projects: _projects,
  workflowRuns: _workflowRuns,
  initialProjectId,
  initialProjectVersionId,
  initialWorkflowRunId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  workflowRuns: WorkflowRun[];
  initialProjectId?: string;
  initialProjectVersionId?: string;
  initialWorkflowRunId?: string;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [versionId, setVersionId] = useState(initialProjectVersionId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>(initialWorkflowRunId ? [initialWorkflowRunId] : []);
  const [testDesignId, setTestDesignId] = useState('');
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<Project>();
  const [runPage, setRunPage] = useState(1);
  const [runQuery, setRunQuery] = useState('');
  const [selectedRuns, setSelectedRuns] = useState<Record<string, WorkflowRun>>({});
  const runResult = useQualityPage(`${projectId}:${versionId}:${runPage}:${runQuery}`, () => api.getWorkflowRuns({ projectId, versionId, status: 'DONE', page: runPage, pageSize: 10, q: runQuery || undefined }), open && Boolean(projectId && versionId), setRunPage);
  const eligibleRuns = runResult.items;
  const canSubmit = Boolean(project && versionId && title.trim() && selectedRunIds.length && testDesignId);
  useEffect(() => {
    if (!open) return;
    setProjectId(initialProjectId ?? '');
    setVersionId(initialProjectVersionId ?? '');
    setSelectedRunIds(initialWorkflowRunId ? [initialWorkflowRunId] : []);
    if (initialWorkflowRunId) void api.getWorkflowRun(initialWorkflowRunId).then(run => setSelectedRuns(current => ({ ...current, [run.id]: run })));
  }, [open, initialProjectId, initialProjectVersionId, initialWorkflowRunId]);
  useEffect(() => {
    if (!open || !projectId) { setProject(undefined); return; }
    let active = true;
    void api.getProject(projectId).then(value => { if (active) setProject(value); }).catch(error => { if (active) toast.error(error instanceof Error ? error.message : '加载项目失败'); });
    return () => { active = false; };
  }, [projectId, open]);
  async function submit() {
    if (!project || !versionId || !title.trim() || !selectedRunIds.length || !testDesignId) {
      toast.error('请选择项目版本、已确认测试设计、提测工作流并填写标题');
      return;
    }
    const requirementIds = [...new Set(selectedRunIds.map(id => selectedRuns[id]?.requirement.id).filter((id): id is string => Boolean(id)))];
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
        testDesignId,
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
          <DialogDescription>确认需求与设计，再关联已完成的研发工作流，冻结本次测试范围。</DialogDescription>
        </DialogHeader>
        <ol className="grid grid-cols-3 gap-2 rounded-md border p-3 text-xs"><li>1 选择项目版本与工作流</li><li>2 确认测试设计</li><li>3 冻结范围并提测</li></ol>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="项目">
              <PagedSelect label="项目" value={projectId} selectedLabel={project?.name} onValueChange={value => { setProjectId(value); setVersionId(''); setSelectedRunIds([]); setTestDesignId(''); setRunPage(1); }} loadPage={query => api.getProjects(query)} placeholder="选择项目" />
            </Field>
            <Field label="项目版本">
              <PagedSelect label="项目版本" value={versionId} onValueChange={value => { setVersionId(value); setSelectedRunIds([]); setTestDesignId(''); setRunPage(1); }} disabled={!projectId} scopeKey={projectId} loadPage={query => api.listProjectVersions(projectId, query)} placeholder="选择版本" />
            </Field>
          </div>
          <Field label="提测标题">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：2.6.0 登录能力提测" />
          </Field>
          <Field label="已确认测试设计">
            <PagedSelect label="已确认测试设计" value={testDesignId} onValueChange={setTestDesignId} disabled={!versionId} scopeKey={`${projectId}:${versionId}:${selectedRunIds.join(',')}`} loadPage={async query => { const result = await api.getTestDesigns({ ...query, projectId, projectVersionId: versionId, status: 'CONFIRMED', availableForRequest: true, workflowRunIds: selectedRunIds }); return { ...result, items: result.items.map(design => ({ id: design.id, name: `第 ${design.revision} 版` })) }; }} placeholder="选择测试设计" />
            <Link className="text-xs text-primary underline" to="/requirements">去准备或修复测试设计</Link>
          </Field>
          <Field label="说明（可选）">
            <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="已完成研发工作流">
            <Input aria-label="搜索提测工作流" value={runQuery} onChange={event => { setRunQuery(event.target.value); setRunPage(1); }} />
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {eligibleRuns.length ? eligibleRuns.map((run) => (
                <label key={run.id} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={selectedRunIds.includes(run.id)}
                    onChange={(event) => { setSelectedRuns(current => ({ ...current, [run.id]: run })); setSelectedRunIds(current => event.target.checked ? [...current, run.id] : current.filter(id => id !== run.id)); setTestDesignId(''); }}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-foreground">{run.requirement.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{run.id}</span>
                  </span>
                </label>
              )) : (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">该版本暂无已完成研发工作流</p>
              )}
            </div>
            <ListPagination page={runPage} total={runResult.total} pageSize={10} onPageChange={setRunPage} />
            <p className="text-xs text-muted-foreground">已选 {selectedRunIds.length} 个工作流</p>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving || !canSubmit} onClick={() => void submit()}>
            {saving ? '创建中...' : '创建提测草稿'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateLibraryDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onCreated,
}: {
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
        <DialogHeader>
          <DialogTitle>新建用例库</DialogTitle>
          <DialogDescription>{projectId ? '创建项目专属用例库。' : '创建 Workspace 共享用例库。'}</DialogDescription>
        </DialogHeader>
        <Field label="名称">
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving || !name.trim()} onClick={() => void submit()}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateCaseDialog({
  open,
  onOpenChange,
  libraries,
  workspaceId,
  projectId,
  initialLibraryId,
  initialModuleId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: TestCaseLibrary[];
  workspaceId: string;
  projectId?: string;
  initialLibraryId?: string;
  initialModuleId?: string;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [libraryId, setLibraryId] = useState('');
  const [moduleId, setModuleId] = useState(NO_MODULE);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [precondition, setPrecondition] = useState('');
  const [testData, setTestData] = useState('');
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextLibraryId = initialLibraryId
      ? initialLibraryId
      : libraries[0]?.id ?? '';
    setLibraryId(nextLibraryId);
    setModuleId(initialModuleId ?? NO_MODULE);
  }, [initialLibraryId, initialModuleId, libraries, open]);





  async function submit() {
    const stepList = steps.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!libraryId || !title.trim() || !stepList.length || !expected.trim()) {
      toast.error('请完整填写用例标题、步骤和预期结果');
      return;
    }
    setSaving(true);
    try {
      await api.createTestCase(libraryId, {
        moduleId: moduleId === NO_MODULE ? undefined : moduleId,
        title: title.trim(),
        priority,
        precondition: precondition.trim() || undefined,
        testData: testData.trim() || undefined,
        targetKeys,
        steps: stepList,
        expected: expected.trim(),
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setTitle('');
      setPrecondition('');
      setTestData('');
      setTargetKeys([]);
      setSteps('');
      setExpected('');
      setTags('');
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
        <DialogHeader>
          <DialogTitle>新建测试用例</DialogTitle>
          <DialogDescription>用例进入提测范围后将冻结为版本快照。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="用例库">
              <PagedSelect label="用例库" value={libraryId} selectedLabel={libraries.find(item => item.id === libraryId)?.name} onValueChange={(value) => {
                setLibraryId(value);
                setModuleId(NO_MODULE);
              }} loadPage={query => api.getTestCaseLibraries({ ...query, workspaceId, projectId })} placeholder="选择用例库" />
            </Field>
            <Field label="模块（可选）">
              <PagedSelect label="模块" value={moduleId === NO_MODULE ? '' : moduleId} onValueChange={value => setModuleId(value || NO_MODULE)} scopeKey={libraryId} disabled={!libraryId} allowClear loadPage={query => api.getTestCaseModules(libraryId, query)} placeholder="未分模块" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="用例编号">
              <Input aria-label="用例编号" value="保存后自动生成" readOnly />
            </Field>
            <Field label="优先级">
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger aria-label="优先级"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['P0', 'P1', 'P2', 'P3'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="标题"><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="前置条件（可选）"><Input value={precondition} onChange={(event) => setPrecondition(event.target.value)} /></Field>
          <Field label="测试数据（可选）"><Textarea rows={2} value={testData} onChange={(event) => setTestData(event.target.value)} /></Field>
          <QualityTargetKeysField value={targetKeys} onChange={setTargetKeys} disabled={saving} />
          <Field label="执行步骤">
            <Textarea rows={4} placeholder="每行一个步骤" value={steps} onChange={(event) => setSteps(event.target.value)} />
          </Field>
          <Field label="预期结果"><Textarea rows={2} value={expected} onChange={(event) => setExpected(event.target.value)} /></Field>
          <Field label="标签（可选）"><Input placeholder="使用英文逗号分隔" value={tags} onChange={(event) => setTags(event.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving} onClick={() => void submit()}>{saving ? '创建中...' : '创建用例'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
