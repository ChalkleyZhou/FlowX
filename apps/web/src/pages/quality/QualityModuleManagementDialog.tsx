import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { ListPagination } from '../../components/ListPagination';
import { PagedSelect } from '../../components/PagedSelect';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Spinner } from '../../components/ui/spinner';
import { useToast } from '../../components/ui/toast';
import type { TestCaseLibrary, TestCaseModule } from '../../types';
import { Field } from './quality-ui';

const ROOT_MODULE = '__root__';

export function QualityModuleManagementDialog({
  open,
  onOpenChange,
  libraries,
  workspaceId,
  projectId,
  defaultLibraryId,
  defaultParentId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: TestCaseLibrary[];
  workspaceId: string;
  projectId?: string;
  defaultLibraryId?: string;
  defaultParentId?: string;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [libraryId, setLibraryId] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [modules, setModules] = useState<TestCaseModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(ROOT_MODULE);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const preferredId = defaultLibraryId && Boolean(defaultLibraryId)
      ? defaultLibraryId
      : libraries[0]?.id ?? '';
    setLibraryId(current => current || preferredId);
  }, [defaultLibraryId, libraries, open]);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setName('');
    setParentId(defaultParentId && defaultLibraryId ? defaultParentId : ROOT_MODULE);
  }, [defaultLibraryId, defaultParentId, open]);

  useEffect(() => {
    if (!open || !libraryId) {
      setModules([]);
      return;
    }
    let active = true;
    setLoading(true);
    void api.getTestCaseModules(libraryId, { page, pageSize: 20 })
      .then((items) => {
        if (!active) return;
        const lastPage = Math.max(1, items.totalPages);
        if (page > lastPage) { setPage(lastPage); return; }
        setModules(items.items); setTotal(items.total);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : '加载模块失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [libraryId, open, page]);

  const moduleNames = useMemo(
    () => new Map(modules.map((module) => [module.id, module.name])),
    [modules],
  );
  const unavailableParentIds = useMemo(
    () => getUnavailableParentIds(modules, editingId),
    [editingId, modules],
  );

  function resetForm() {
    setEditingId(null);
    setName('');
    setParentId(ROOT_MODULE);
  }

  function startEditing(module: TestCaseModule) {
    setEditingId(module.id);
    setName(module.name);
    setParentId(module.parentId ?? ROOT_MODULE);
  }

  async function reloadModules() {
    if (!libraryId) return;
    try {
      const items = await api.getTestCaseModules(libraryId, { page, pageSize: 20 });
      const lastPage = Math.max(1, items.totalPages);
      if (page > lastPage) { setPage(lastPage); return; }
      setModules(items.items); setTotal(items.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新模块列表失败');
    }
  }

  async function saveModule() {
    const trimmedName = name.trim();
    if (!libraryId || !trimmedName) {
      toast.error('请填写模块名称');
      return;
    }
    setBusyId(editingId ?? 'create');
    try {
      const targetParentId = parentId === ROOT_MODULE ? null : parentId;
      if (editingId) {
        await api.updateTestCaseModule(editingId, { name: trimmedName, parentId: targetParentId });
        toast.success('模块已更新');
      } else {
        await api.createTestCaseModule(libraryId, {
          name: trimmedName,
          parentId: targetParentId ?? undefined,
        });
        toast.success('模块已创建');
      }
      resetForm();
      await Promise.all([reloadModules(), onChanged()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存模块失败');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteModule(module: TestCaseModule) {
    if ((module._count?.children ?? 0) > 0) return;
    const affectedCases = module._count?.cases ?? 0;
    const confirmed = await confirm({
      title: '删除模块',
      description: `确认删除“${module.name}”吗？${affectedCases > 0 ? `该模块下的 ${affectedCases} 条有效用例将转为“未分模块”。` : ''}用例内容和历史提测快照不会被删除。`,
      confirmLabel: '删除模块',
      destructive: true,
    });
    if (!confirmed) return;

    setBusyId(module.id);
    try {
      const result = await api.deleteTestCaseModule(module.id);
      if (editingId === module.id) resetForm();
      toast.success(result.affectedCases > 0
        ? `模块已删除，${result.affectedCases} 条用例已转为未分模块`
        : '模块已删除');
      await Promise.all([reloadModules(), onChanged()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除模块失败');
    } finally {
      setBusyId(null);
    }
  }

  function changeLibrary(nextLibraryId: string) {
    setPage(1);
    setLibraryId(nextLibraryId);
    resetForm();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busyId && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>模块管理</DialogTitle>
          <DialogDescription>按用例库维护模块层级。模块名称在同一个用例库内不可重复。</DialogDescription>
        </DialogHeader>

        <Field label="用例库">
          <PagedSelect label="用例库" value={libraryId} selectedLabel={libraries.find(item => item.id === libraryId)?.name} onValueChange={changeLibrary} loadPage={query => api.getTestCaseLibraries({ ...query, workspaceId, projectId })} placeholder="选择用例库" />
        </Field>

        <div className="rounded-md border border-border bg-muted/50 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">{editingId ? '编辑模块' : '新增模块'}</h3>
            {editingId ? (
              <Button type="button" variant="ghost" size="icon" aria-label="取消编辑模块" onClick={resetForm}>
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_190px_auto]">
            <Field label="模块名称">
              <Input
                aria-label="模块名称"
                placeholder="输入模块名称"
                value={name}
                disabled={Boolean(busyId)}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveModule();
                }}
              />
            </Field>
            <Field label="上级模块">
              <PagedSelect label="上级模块" selectedLabel={moduleNames.get(parentId)} value={parentId === ROOT_MODULE ? '' : parentId} onValueChange={value => setParentId(value || ROOT_MODULE)} allowClear scopeKey={libraryId} loadPage={query => api.getTestCaseModules(libraryId, { ...query, excludeId: editingId ?? undefined })} placeholder="一级模块" />
            </Field>
            <Button type="button" disabled={Boolean(busyId) || !libraryId || !name.trim()} onClick={() => void saveModule()}>
              {editingId ? null : <Plus aria-hidden="true" className="h-4 w-4" />}
              {busyId ? '保存中...' : editingId ? '保存修改' : '添加模块'}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center"><Spinner className="h-6 w-6" /></div>
          ) : modules.length ? (
            <div className="divide-y divide-border">
              {modules.map((module) => {
                const childCount = module._count?.children ?? 0;
                return (
                  <div key={module.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{module.name}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {module.parentId ? `上级：${moduleNames.get(module.parentId) ?? '未知模块'} · ` : '一级模块 · '}
                        {module._count?.cases ?? 0} 条有效用例
                        {childCount > 0 ? ` · ${childCount} 个子模块` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`编辑模块：${module.name}`}
                        disabled={Boolean(busyId)}
                        onClick={() => startEditing(module)}
                      >
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        title={childCount > 0 ? '请先删除子模块' : '删除模块'}
                        aria-label={`删除模块：${module.name}`}
                        disabled={Boolean(busyId) || childCount > 0}
                        onClick={() => void deleteModule(module)}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">当前用例库还没有模块</p>
          )}
        </div>
        <ListPagination page={page} total={total} pageSize={20} onPageChange={setPage} />
      </DialogContent>
    </Dialog>
  );
}

function getUnavailableParentIds(modules: TestCaseModule[], editingId: string | null) {
  const unavailable = new Set<string>();
  if (!editingId) return unavailable;
  unavailable.add(editingId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of modules) {
      if (module.parentId && unavailable.has(module.parentId) && !unavailable.has(module.id)) {
        unavailable.add(module.id);
        changed = true;
      }
    }
  }
  return unavailable;
}
