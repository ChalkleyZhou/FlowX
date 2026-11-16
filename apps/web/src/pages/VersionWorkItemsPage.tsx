import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ListPagination } from '../components/ListPagination';
import { ListToolbar } from '../components/ListToolbar';
import { PageHeader } from '../components/PageHeader';
import { PagedSelect } from '../components/PagedSelect';
import { RequirementListTable } from '../components/RequirementListTable';
import { WorkItemEditDialog } from '../components/WorkItemEditDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import type { Bug, Issue, ProjectVersionSummary, Requirement, WorkItem } from '../types';
import { formatBugStatus, formatIssueStatus, formatPriority, formatSeverity } from '../utils/label-utils';

const PAGE_SIZE = 20;
type WorkItemKind = WorkItem['kind'];

const kindTabs: Array<{ value: WorkItemKind; label: string }> = [
  { value: 'REQUIREMENT', label: '需求' },
  { value: 'ISSUE', label: '问题' },
  { value: 'BUG', label: '缺陷' },
];

function parseKind(value: string | null): WorkItemKind {
  return kindTabs.some(tab => tab.value === value) ? value as WorkItemKind : 'REQUIREMENT';
}

function formatKindLabel(kind: WorkItemKind) {
  return kindTabs.find(tab => tab.value === kind)?.label ?? '工作项';
}

function TableHeader({ labels }: { labels: string[] }) {
  return <thead className="bg-muted/40 text-left text-muted-foreground"><tr>{labels.map(label => <th key={label} className={label === '操作' ? 'sticky right-0 z-20 whitespace-nowrap border-l border-border bg-muted px-4 py-3 font-medium' : 'whitespace-nowrap px-4 py-3 font-medium'}>{label}</th>)}</tr></thead>;
}

function EditButton({ onClick }: { onClick: () => void }) {
  return <Button variant="default" size="sm" onClick={onClick}>编辑</Button>;
}

function IssueTable({ items, onEdit }: { items: Issue[]; onEdit: (item: Issue) => void }) {
  return <table className="w-max min-w-full text-sm"><TableHeader labels={['问题标题', '问题描述', '状态', '优先级', '来源工作流', '分支', '操作']} /><tbody>{items.map(item => <tr key={item.id} className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-3 font-medium"><div className="flex min-w-[220px] flex-col gap-1"><button type="button" onClick={() => onEdit(item)} title={item.title} className="block max-w-[260px] truncate text-left text-foreground hover:text-primary">{item.title}</button><span className="text-xs font-normal text-muted-foreground">{item.displayCode ?? item.id}</span></div></td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description?.trim() || '未填写'}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="secondary">{formatIssueStatus(item.status)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.sourceWorkflowRun?.id ? <Link className="text-primary hover:underline" to={`/workflow-runs/${item.sourceWorkflowRun.id}`}>查看来源流程</Link> : '未关联'}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.branchName || '未记录'}</td>
    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3"><EditButton onClick={() => onEdit(item)} /></td>
  </tr>)}</tbody></table>;
}

function BugTable({ items, onEdit }: { items: Bug[]; onEdit: (item: Bug) => void }) {
  return <table className="w-max min-w-full text-sm"><TableHeader labels={['缺陷标题', '缺陷描述', '严重级别', '优先级', '状态', '来源工作流', '分支', '操作']} /><tbody>{items.map(item => <tr key={item.id} className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-3 font-medium"><div className="flex min-w-[220px] flex-col gap-1"><button type="button" onClick={() => onEdit(item)} title={item.title} className="block max-w-[260px] truncate text-left text-foreground hover:text-primary">{item.title}</button><span className="text-xs font-normal text-muted-foreground">{item.displayCode ?? item.id}</span></div></td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description?.trim() || '未填写'}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="destructive">{formatSeverity(item.severity)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="secondary">{formatBugStatus(item.status)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.workflowRun?.id ? <Link className="text-primary hover:underline" to={`/workflow-runs/${item.workflowRun.id}`}>查看来源流程</Link> : '未关联'}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.branchName || '未记录'}</td>
    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3"><EditButton onClick={() => onEdit(item)} /></td>
  </tr>)}</tbody></table>;
}

export function VersionWorkItemsPage({
  projectId: projectIdProp,
  versionId: versionIdProp,
  onVersionChange,
  showManagementLink = false,
}: {
  projectId?: string;
  versionId?: string;
  onVersionChange?: (versionId: string) => void;
  showManagementLink?: boolean;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = projectIdProp ?? params.projectId ?? '';
  const versionId = versionIdProp ?? params.versionId ?? '';
  const kind = parseKind(searchParams.get('kind'));
  const toast = useToast();
  const requestEpoch = useRef(0);
  const [version, setVersion] = useState<ProjectVersionSummary | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [typedPage, setTypedPage] = useState(1);
  const [typedTotal, setTypedTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null);
  const [draft, setDraft] = useState({ kind: 'REQUIREMENT' as WorkItem['kind'], title: '', description: '', remark: '', splitMode: 'AI' as 'AI' | 'SINGLE' | 'MANUAL' });

  function clearLists() {
    setRequirements([]); setIssues([]); setBugs([]); setTypedPage(1); setTypedTotal(0);
  }

  async function load(next?: string | number) {
    if (!projectId || !versionId) return;
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError('');
    try {
      const query = { projectId, versionId, q: q.trim() || undefined, page: typeof next === 'number' ? next : 1, pageSize: PAGE_SIZE };
      if (kind === 'REQUIREMENT') {
        const result = await api.getRequirements(query);
        if (epoch !== requestEpoch.current) return;
        setRequirements(result.items); setTypedPage(result.page); setTypedTotal(result.total);
      } else if (kind === 'ISSUE') {
        const result = await api.getIssues(query);
        if (epoch !== requestEpoch.current) return;
        setIssues(result.items); setTypedPage(result.page); setTypedTotal(result.total);
      } else {
        const result = await api.getBugs(query);
        if (epoch !== requestEpoch.current) return;
        setBugs(result.items); setTypedPage(result.page); setTypedTotal(result.total);
      }
    } catch (reason) {
      if (epoch !== requestEpoch.current) return;
      const message = reason instanceof Error ? reason.message : '加载版本工作项失败';
      setError(message); toast.error(message);
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }

  useEffect(() => {
    void api.getProjectVersion(projectId, versionId).then(setVersion).catch(() => setVersion(null));
  }, [projectId, versionId]);

  useEffect(() => {
    clearLists();
    void load();
  }, [projectId, versionId, kind]);

  async function create() {
    if (!draft.title.trim()) return;
    try {
      await api.createVersionWorkItem(projectId, versionId, draft);
      setDraft({ kind: 'REQUIREMENT', title: '', description: '', remark: '', splitMode: 'AI' });
      setCreateOpen(false);
      await load(typedPage);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '创建工作项失败');
    }
  }

  async function openEditor(id: string) {
    try {
      setEditingItem(await api.getWorkItem(id));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '加载工作项失败');
    }
  }

  async function handleSaved() {
    setEditingItem(null);
    await load(typedPage);
  }

  function changeVersion(nextVersionId: string) {
    if (onVersionChange) {
      onVersionChange(nextVersionId);
      return;
    }
    if (projectId) navigate(`/projects/${projectId}/versions/${nextVersionId}/work-items`);
  }

  function changeKind(nextKind: WorkItemKind) {
    const next = new URLSearchParams(searchParams);
    next.set('kind', nextKind);
    setSearchParams(next);
  }

  function openCreate() {
    setDraft(current => ({ ...current, kind }));
    setCreateOpen(true);
  }

  const visibleItems = kind === 'REQUIREMENT' ? requirements : kind === 'ISSUE' ? issues : bugs;
  const emptyDescription = kind === 'REQUIREMENT' ? '当前版本还没有需求。' : kind === 'ISSUE' ? '当前版本还没有问题。' : '当前版本还没有缺陷。';
  const createKindLabel = formatKindLabel(draft.kind);

  return (
    <div className="space-y-5">
      {editingItem ? <WorkItemEditDialog workItem={editingItem} open onOpenChange={open => { if (!open) setEditingItem(null); }} onSaved={() => void handleSaved()} /> : null}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setDraft({ kind, title: '', description: '', remark: '', splitMode: 'AI' });
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>快速新建{createKindLabel}</DialogTitle>
            <DialogDescription>填写标题即可创建当前版本的工作项，确认前不会派发执行项。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="version-work-item-kind">类型</label>
              <Select value={draft.kind} onValueChange={value => setDraft(current => ({ ...current, kind: value as WorkItem['kind'] }))}>
                <SelectTrigger id="version-work-item-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REQUIREMENT">需求</SelectItem>
                  <SelectItem value="ISSUE">问题</SelectItem>
                  <SelectItem value="BUG">缺陷</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="version-work-item-title">标题</label>
              <Input id="version-work-item-title" autoFocus placeholder="例如：支持按组织维度导出报表" value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="version-work-item-description">描述</label>
              <Textarea id="version-work-item-description" rows={4} placeholder="补充会议记录或工作项背景（可选）" value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="version-work-item-remark">备注</label>
              <Input id="version-work-item-remark" placeholder="备注（可选）" value={draft.remark} onChange={event => setDraft(current => ({ ...current, remark: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={() => void create()} disabled={!draft.title.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        eyebrow="Version work items"
        title="版本工作台"
        description="统一查看需求、问题和缺陷，直接编辑常用信息。"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <PagedSelect className="w-36" value={versionId} selectedLabel={version?.name} label="切换版本" placeholder="选择版本" scopeKey={projectId} loadPage={query => api.listProjectVersions(projectId, query)} onValueChange={changeVersion} />
            {showManagementLink ? <Button variant="outline" asChild><Link to={`/versions/manage?projectId=${encodeURIComponent(projectId)}`}>版本配置</Link></Button> : null}
            <Button onClick={openCreate}>快速新建</Button>
          </div>
        )}
      />
      <Card>
        <CardContent className="space-y-4 p-5">
          <Tabs value={kind} onValueChange={value => changeKind(parseKind(value))}>
            <TabsList aria-label="工作项类型">
              {kindTabs.map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <ListToolbar
            className="mb-0"
            search={<Input className="max-w-xs" placeholder="搜索标题或描述" value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(1); }} />}
            filters={<Button variant="outline" onClick={() => void load(1)}>查询</Button>}
          />
          {error ? <p role="alert" className="text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={() => void load(typedPage)}>重试</Button></p> : null}
          {loading && visibleItems.length === 0 ? <div className="flex min-h-40 items-center justify-center"><Spinner className="h-7 w-7" /></div> : visibleItems.length > 0 ? <div className="overflow-x-auto rounded-md border border-border">{kind === 'REQUIREMENT' ? <RequirementListTable items={requirements} onOpen={item => void openEditor(item.id)} renderActions={item => <EditButton onClick={() => void openEditor(item.id)} />} /> : kind === 'ISSUE' ? <IssueTable items={issues} onEdit={item => void openEditor(item.id)} /> : <BugTable items={bugs} onEdit={item => void openEditor(item.id)} />}</div> : <EmptyState description={emptyDescription} />}
          <ListPagination page={typedPage} total={typedTotal} pageSize={PAGE_SIZE} loading={loading} onPageChange={page => void load(page)} label={`${kind === 'REQUIREMENT' ? '需求' : kind === 'ISSUE' ? '问题' : '缺陷'}列表分页`} />
        </CardContent>
      </Card>
    </div>
  );
}
