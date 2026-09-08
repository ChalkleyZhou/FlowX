import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
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
import type { Project, TestCaseLibrary, TestCaseModule, TestDesign, WorkflowRun } from '../../types';
import { Field } from './quality-ui';

const NO_MODULE = '__none__';

export function CreateRequestDialog({
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
  const [testDesigns, setTestDesigns] = useState<TestDesign[]>([]);
  const [testDesignId, setTestDesignId] = useState('');
  const [saving, setSaving] = useState(false);
  const project = projects.find((item) => item.id === projectId);
  const eligibleRuns = workflowRuns.filter(
    (run) =>
      run.status.toUpperCase() === 'DONE' &&
      run.requirement.project.id === projectId &&
      run.requirement.versionId === versionId,
  );
  const compatibleTestDesigns = useMemo(
    () => testDesigns.filter((design) => (
      !design.testRequest
      && selectedRunIds.every((runId) => design.workflowRuns?.some((link) => link.workflowRun.id === runId))
    )),
    [testDesigns, selectedRunIds],
  );

  useEffect(() => {
    if (!open || !projectId || !versionId) {
      setTestDesigns([]);
      setTestDesignId('');
      return;
    }
    void api.getTestDesigns({ projectId, projectVersionId: versionId, status: 'CONFIRMED' })
      .then((items) => {
        setTestDesigns(items);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载测试设计失败'));
  }, [open, projectId, versionId]);

  useEffect(() => {
    setTestDesignId((current) => (
      compatibleTestDesigns.some((item) => item.id === current)
        ? current
        : compatibleTestDesigns[0]?.id ?? ''
    ));
  }, [compatibleTestDesigns]);

  async function submit() {
    if (!project || !versionId || !title.trim() || !selectedRunIds.length || !testDesignId) {
      toast.error('请选择项目版本、已确认测试设计、提测工作流并填写标题');
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
          <DialogDescription>关联已完成的研发工作流，创建测试范围草稿。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="项目">
              <Select
                value={projectId}
                onValueChange={(value) => {
                  setProjectId(value);
                  setVersionId('');
                  setSelectedRunIds([]);
                  setTestDesignId('');
                }}
              >
                <SelectTrigger aria-label="项目"><SelectValue placeholder="选择项目" /></SelectTrigger>
                <SelectContent>
                  {projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="项目版本">
              <Select
                value={versionId}
                onValueChange={(value) => {
                  setVersionId(value);
                  setSelectedRunIds([]);
                  setTestDesignId('');
                }}
                disabled={!project}
              >
                <SelectTrigger aria-label="项目版本"><SelectValue placeholder="选择版本" /></SelectTrigger>
                <SelectContent>
                  {(project?.versions ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="提测标题">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：2.6.0 登录能力提测" />
          </Field>
          <Field label="已确认测试设计">
            <Select value={testDesignId} onValueChange={setTestDesignId} disabled={!versionId || !compatibleTestDesigns.length}>
              <SelectTrigger aria-label="已确认测试设计"><SelectValue placeholder="选择测试设计" /></SelectTrigger>
              <SelectContent>
                {compatibleTestDesigns.map((item) => <SelectItem key={item.id} value={item.id}>第 {item.revision} 版 · {item.candidates.length} 条功能用例 / {item.smokeCases.length} 条冒烟</SelectItem>)}
              </SelectContent>
            </Select>
            {versionId && !compatibleTestDesigns.length ? <p className="mt-1 text-xs text-muted-foreground">当前所选工作流暂无可用的已确认测试设计，请先从工作流详情创建并确认。</p> : null}
          </Field>
          <Field label="说明（可选）">
            <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="已完成研发工作流">
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {eligibleRuns.length ? eligibleRuns.map((run) => (
                <label key={run.id} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={selectedRunIds.includes(run.id)}
                    onChange={(event) => setSelectedRunIds((current) =>
                      event.target.checked
                        ? [...current, run.id]
                        : current.filter((id) => id !== run.id),
                    )}
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
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving} onClick={() => void submit()}>
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
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: TestCaseLibrary[];
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [libraryId, setLibraryId] = useState('');
  const [modules, setModules] = useState<TestCaseModule[]>([]);
  const [moduleId, setModuleId] = useState(NO_MODULE);
  const [externalId, setExternalId] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [precondition, setPrecondition] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && !libraries.some((library) => library.id === libraryId)) {
      setLibraryId(libraries[0]?.id ?? '');
    }
  }, [libraries, libraryId, open]);

  useEffect(() => {
    if (!open || !libraryId) {
      setModules([]);
      return;
    }
    let active = true;
    void api.getTestCaseModules(libraryId)
      .then((items) => {
        if (!active) return;
        setModules(items);
        setModuleId((current) => items.some((item) => item.id === current) ? current : NO_MODULE);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : '加载用例模块失败');
      });
    return () => { active = false; };
  }, [libraryId, open]);

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
        externalId: externalId.trim() || undefined,
        title: title.trim(),
        priority,
        precondition: precondition.trim() || undefined,
        steps: stepList,
        expected: expected.trim(),
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      setExternalId('');
      setTitle('');
      setPrecondition('');
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
              <Select value={libraryId} onValueChange={(value) => {
                setLibraryId(value);
                setModuleId(NO_MODULE);
              }}>
                <SelectTrigger aria-label="用例库"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {libraries.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="模块（可选）">
              <Select value={moduleId} onValueChange={setModuleId}>
                <SelectTrigger aria-label="模块"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MODULE}>未分模块</SelectItem>
                  {modules.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="用例编号（可选）">
              <Input value={externalId} onChange={(event) => setExternalId(event.target.value)} />
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
