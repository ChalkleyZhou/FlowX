import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
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
import type { TestCaseDefinition, TestCaseLibrary, TestCaseModule } from '../../types';
import { Field } from './quality-ui';

const NO_MODULE = '__none__';

export function QualityCaseEditDialog({
  open,
  onOpenChange,
  testCase,
  libraries,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCase: TestCaseDefinition | null;
  libraries: TestCaseLibrary[];
  onUpdated: (updated: TestCaseDefinition) => Promise<void>;
}) {
  const toast = useToast();
  const [libraryId, setLibraryId] = useState('');
  const [modules, setModules] = useState<TestCaseModule[]>([]);
  const [moduleId, setModuleId] = useState(NO_MODULE);
  const [externalId, setExternalId] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TestCaseDefinition['priority']>('P2');
  const [precondition, setPrecondition] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !testCase) return;
    setLibraryId(testCase.libraryId);
    setModuleId(testCase.moduleId ?? NO_MODULE);
    setExternalId(testCase.externalId ?? '');
    setTitle(testCase.title);
    setPriority(testCase.priority);
    setPrecondition(testCase.precondition ?? '');
    setSteps(testCase.steps.join('\n'));
    setExpected(testCase.expected);
    setTags(testCase.tags?.join(', ') ?? '');
  }, [open, testCase]);

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
    if (!testCase) return;
    const stepList = steps.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!libraryId || !title.trim() || !stepList.length || !expected.trim()) {
      toast.error('请完整填写用例标题、步骤和预期结果');
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateTestCase(testCase.id, {
        libraryId,
        moduleId: moduleId === NO_MODULE ? null : moduleId,
        externalId: externalId.trim() || null,
        title: title.trim(),
        priority,
        precondition: precondition.trim() || null,
        steps: stepList,
        expected: expected.trim(),
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      toast.success(`测试用例已更新至 v${updated.version}`);
      await onUpdated(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新测试用例失败');
    } finally {
      setSaving(false);
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (!saving) onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑测试用例</DialogTitle>
          <DialogDescription>保存后生成新的用例版本，历史提测快照保持不变。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="用例库">
              <Select value={libraryId} onValueChange={(value) => {
                setLibraryId(value);
                setModuleId(NO_MODULE);
              }} disabled={saving}>
                <SelectTrigger aria-label="编辑用例库"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {libraries.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="模块（可选）">
              <Select value={moduleId} onValueChange={setModuleId} disabled={saving}>
                <SelectTrigger aria-label="编辑模块"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MODULE}>未分模块</SelectItem>
                  {modules.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="用例编号（可选）">
              <Input aria-label="编辑用例编号" value={externalId} disabled={saving} onChange={(event) => setExternalId(event.target.value)} />
            </Field>
            <Field label="优先级">
              <Select value={priority} onValueChange={(value) => setPriority(value as TestCaseDefinition['priority'])} disabled={saving}>
                <SelectTrigger aria-label="编辑优先级"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['P0', 'P1', 'P2', 'P3'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="标题">
            <Input aria-label="编辑标题" value={title} disabled={saving} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="前置条件（可选）">
            <Input aria-label="编辑前置条件" value={precondition} disabled={saving} onChange={(event) => setPrecondition(event.target.value)} />
          </Field>
          <Field label="执行步骤">
            <Textarea aria-label="编辑执行步骤" rows={5} value={steps} disabled={saving} onChange={(event) => setSteps(event.target.value)} />
          </Field>
          <Field label="预期结果">
            <Textarea aria-label="编辑预期结果" rows={3} value={expected} disabled={saving} onChange={(event) => setExpected(event.target.value)} />
          </Field>
          <Field label="标签（可选）">
            <Input aria-label="编辑标签" value={tags} disabled={saving} onChange={(event) => setTags(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => changeOpen(false)}>取消</Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>{saving ? '保存中...' : '保存修改'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
