import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import type {
  QualityCaseSelection,
  TestCaseDefinition,
  TestCaseLibrary,
  TestCaseModule,
  TestDesign,
} from '../../types';

interface Props {
  workspaceId: string;
  projectId: string;
  design?: TestDesign;
  onSelectionChange?: (selection: QualityCaseSelection) => void;
  onDesignChange?: (design: TestDesign) => void;
}
export function QualityScopePanel(props: Props) {
  return <QualityScopeContent key={`${props.workspaceId}:${props.projectId}`} {...props} />;
}
function QualityScopeContent({ workspaceId, projectId, design, onSelectionChange, onDesignChange }: Props) {
  const toast = useToast();
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
  const [modules, setModules] = useState<TestCaseModule[]>([]);
  const [selection, setSelection] = useState<QualityCaseSelection>(
    design?.caseSelection ?? { libraryIds: [] },
  );
  const [cases, setCases] = useState<TestCaseDefinition[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [moduleId, setModuleId] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const callback = useRef(onSelectionChange);
  callback.current = onSelectionChange;
  const frozen =
    Boolean(design?.testRequest) || design?.status === 'CONFIRMED' || design?.status === 'GENERATING';
  const normalizeSelection = (value: QualityCaseSelection | null | undefined) =>
    value
      ? JSON.stringify({
          ...value,
          libraryIds: [...value.libraryIds].sort(),
          moduleIds: [...(value.moduleIds ?? [])].sort(),
        })
      : '';
  const dirty = Boolean(design && normalizeSelection(design.caseSelection) !== normalizeSelection(selection));
  const canSupplement =
    !dirty && !frozen && (!design || ['WAITING_REVIEW', 'NOT_STARTED'].includes(design.status));
  useEffect(() => {
    let active = true;
    void api
      .getTestCaseLibraries({ workspaceId, projectId })
      .then((items) => {
        if (!active) return;
        setLibraries(items);
        const initial = design?.caseSelection ?? {
          libraryIds: items.filter((item) => item.projectId === projectId).map((item) => item.id),
        };
        setSelection(initial);
        callback.current?.(initial);
        setLoading(false);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '加载用例库失败');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, projectId]);
  useEffect(() => {
    let active = true;
    setChecked([]);
    setCases([]);
    setModules([]);
    if (!selection.libraryIds.length) return;
    setLoading(true);
    void Promise.all(
      selection.libraryIds.map(async (libraryId) => ({
        modules: await api.getTestCaseModules(libraryId),
        cases: await api.getTestCases({ workspaceId, projectId, libraryId }),
      })),
    )
      .then((groups) => {
        if (active) {
          setModules(groups.flatMap((group) => group.modules));
          setCases(groups.flatMap((group) => group.cases));
          setError('');
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '加载范围失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selection.libraryIds.join(','), workspaceId, projectId]);
  function update(next: QualityCaseSelection) {
    setSelection(next);
    callback.current?.(next);
    setChecked([]);
  }
  const descendants = new Set(moduleId !== 'all' ? [moduleId] : []);
  for (let index = 0; index < modules.length; index += 1)
    for (const module of modules)
      if (module.parentId && descendants.has(module.parentId)) descendants.add(module.id);
  const selectedModules = new Set(selection.moduleIds ?? []);
  for (let index = 0; index < modules.length; index += 1)
    for (const module of modules)
      if (module.parentId && selectedModules.has(module.parentId)) selectedModules.add(module.id);
  const visible = cases.filter(
    (item) =>
      item.status === 'ACTIVE' &&
      (moduleId === 'all' || Boolean(item.moduleId && descendants.has(item.moduleId))) &&
      (!selectedModules.size || Boolean(item.moduleId && selectedModules.has(item.moduleId))) &&
      (!selection.priorities?.length || selection.priorities.includes(item.priority)) &&
      (!query.trim() ||
        `${item.title} ${item.externalId ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  async function saveSelection() {
    if (!design) return;
    setBusy(true);
    try {
      onDesignChange?.(
        await api.updateQualitySelection(design.id, { revision: design.revision, caseSelection: selection }),
      );
      toast.success('选例范围已保存，请重新生成建议');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '保存选例范围失败');
    } finally {
      setBusy(false);
    }
  }
  async function supplement() {
    if (!design || !checked.length) return;
    setBusy(true);
    try {
      onDesignChange?.(
        await api.addQualityCandidates(design.id, { revision: design.revision, definitionIds: checked }),
      );
      setChecked([]);
      toast.success('人工补选已纳入');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '人工补选失败');
    } finally {
      setBusy(false);
    }
  }
  const summary = design?.retrievalSummary;
  return (
    <section aria-label="用例库与选例范围" className="rounded-md border p-4 space-y-4">
      <div>
        <h2 className="font-semibold">选择用例范围</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          默认使用项目库；共享库需明确选择。父模块包含子模块。AI 建议之外的用例可人工补选。
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_200px]">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">用例库</legend>
          {libraries.map((library) => (
            <label key={library.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`用例库 ${library.name}`}
                disabled={frozen}
                checked={selection.libraryIds.includes(library.id)}
                onChange={(e) => {
                  setModuleId('all');
                  update({
                    libraryIds: e.target.checked
                      ? [...selection.libraryIds, library.id]
                      : selection.libraryIds.filter((id) => id !== library.id),
                  });
                }}
              />
              <span>
                {library.name}
                <span className="block text-xs text-muted-foreground">
                  {library.projectId ? '项目库' : '共享库'}
                </span>
              </span>
            </label>
          ))}
          {!libraries.length && !loading ? (
            <p className="text-sm text-muted-foreground">暂无可用用例库，请先创建项目用例库。</p>
          ) : null}
        </fieldset>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="sm:w-52"
              aria-label="搜索补选用例"
              placeholder="搜索标题或编号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="max-w-full rounded border bg-background p-2 text-sm"
              aria-label="筛选用例模块"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
            >
              <option value="all">全部模块</option>
              {modules.map((module) => (
                <option key={module.id} value={module.id}>
                  {module.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-xs text-muted-foreground">
              生成范围模块（不选表示所选库全部模块）
            </legend>
            {modules.map((module) => (
              <label className="flex gap-1 text-xs" key={module.id}>
                <input
                  type="checkbox"
                  disabled={frozen}
                  checked={selection.moduleIds?.includes(module.id) ?? false}
                  onChange={(e) =>
                    update({
                      ...selection,
                      moduleIds: e.target.checked
                        ? [...(selection.moduleIds ?? []), module.id]
                        : selection.moduleIds?.filter((id) => id !== module.id),
                    })
                  }
                />
                {module.name}
              </label>
            ))}
          </fieldset>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-2">
            {loading ? (
              <p role="status" className="p-2 text-sm">
                范围加载中…
              </p>
            ) : (
              visible.map((item) => {
                const included = design?.candidates.some(
                  (candidate) =>
                    candidate.sourceDefinitionId === item.id &&
                    candidate.action !== 'EXCLUDE' &&
                    candidate.resolution !== 'REJECTED',
                );
                return (
                  <label key={item.id} className="flex gap-2 rounded p-2 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      aria-label={`补选 ${item.title}`}
                      checked={checked.includes(item.id)}
                      disabled={!canSupplement || included}
                      onChange={(e) =>
                        setChecked((ids) =>
                          e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>
                      {item.title}
                      <span className="block text-xs text-muted-foreground">
                        {item.priority} ·{' '}
                        {modules.find((module) => module.id === item.moduleId)?.name ?? '未分模块'} ·{' '}
                        {included ? '已纳入候选' : `原用例 v${item.version}`}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
            {!loading && !visible.length ? (
              <p className="p-2 text-sm text-muted-foreground">
                所选范围暂无匹配用例，不会自动扩大到其他库。
              </p>
            ) : null}
          </div>
          {dirty && !frozen ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              选例范围尚未保存，请先保存范围，再人工补选；保存会清空旧建议。
            </p>
          ) : null}
          {design && !frozen ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !checked.length || !canSupplement}
              onClick={() => void supplement()}
            >
              人工纳入所选用例
            </Button>
          ) : null}
        </div>
        <aside className="space-y-2 text-sm">
          <p className="font-medium">本次范围摘要</p>
          <p>
            已选 {selection.libraryIds.length} 个库 · {selection.moduleIds?.length ?? 0} 个限定模块
          </p>
          <p>
            可见用例 {visible.length} 条 · 补选 {checked.length} 条
          </p>
          {summary ? (
            <>
              <p>
                候选 {summary.eligibleCount} · 匹配 {summary.matchedCount} · AI 输入 {summary.suppliedCount}
              </p>
              {summary.truncated ? (
                <p className="text-amber-700 dark:text-amber-400">
                  AI 输入已截断，未进入输入的用例仍可人工补选。
                </p>
              ) : null}
            </>
          ) : null}
          {design && !frozen ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selection.libraryIds.length}
              onClick={() => void saveSelection()}
            >
              {design.candidates.length ? '保存范围并清空旧建议' : '保存选例范围'}
            </Button>
          ) : null}
          {!selection.libraryIds.length ? <p className="text-destructive">请至少选择一个用例库。</p> : null}
        </aside>
      </div>
    </section>
  );
}
