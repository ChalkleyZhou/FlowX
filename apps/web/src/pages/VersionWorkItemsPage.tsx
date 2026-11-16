import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ListPagination } from '../components/ListPagination';
import { ListToolbar } from '../components/ListToolbar';
import { PageHeader } from '../components/PageHeader';
import { PagedSelect } from '../components/PagedSelect';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { useToast } from '../components/ui/toast';
import type { Bug, Issue, ProjectVersionSummary, Requirement, WorkItem } from '../types';
import { formatBugStatus, formatIssueStatus, formatPriority, formatSeverity } from '../utils/label-utils';

const PAGE_SIZE = 20;
type WorkItemKind = 'ALL' | WorkItem['kind'];

const kindTabs: Array<{ value: WorkItemKind; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'REQUIREMENT', label: '需求' },
  { value: 'ISSUE', label: '问题' },
  { value: 'BUG', label: '缺陷' },
];

function parseKind(value: string | null): WorkItemKind {
  return kindTabs.some(tab => tab.value === value) ? value as WorkItemKind : 'ALL';
}

function formatDate(value?: string | null) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatWorkItemStatus(item: WorkItem) {
  if (item.kind === 'BUG') return formatBugStatus(item.status);
  if (item.kind === 'ISSUE') return formatIssueStatus(item.status);
  const map: Record<string, string> = { ACTIVE: '进行中', OPEN: '待处理', IN_PROGRESS: '处理中', RESOLVED: '已解决', CLOSED: '已关闭' };
  return (map[item.status] ?? item.status) || '未设置';
}

function TableHeader({ labels }: { labels: string[] }) {
  return <thead className="bg-muted/40 text-left text-muted-foreground"><tr>{labels.map(label => <th key={label} className={label === '操作' ? 'sticky right-0 z-20 whitespace-nowrap border-l border-border bg-muted px-4 py-3 font-medium' : 'whitespace-nowrap px-4 py-3 font-medium'}>{label}</th>)}</tr></thead>;
}

function DetailButton({ id }: { id: string }) {
  return <Button variant="default" size="sm" asChild><Link to={`/work-items/${id}`}>详情</Link></Button>;
}

function RequirementTable({ items }: { items: Requirement[] }) {
  return <table className="w-max min-w-full text-sm"><TableHeader labels={['需求标题', '需求描述', '优先级', '创建人', '创建时间', '需求变更时间', '最新变更内容', '备注', '操作']} /><tbody>{items.map(item => <tr key={item.id} className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-3 font-medium"><Link to={`/work-items/${item.id}`} className="text-foreground no-underline hover:text-primary">{item.title}</Link>{item.prototypeImport && item.prototypeImport.status !== 'CONFIRMED' ? <Badge className="ml-2" variant="warning">{item.prototypeImport.status === 'FAILED' ? '导入失败' : '原型导入中'}</Badge> : null}</td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description?.trim() || '未填写'}</td>
    <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
    <td className="whitespace-nowrap px-4 py-3">{item.createdByName?.trim() || '未记录'}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground"><time dateTime={item.createdAt ?? undefined}>{formatDate(item.createdAt)}</time></td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.latestChangeAt ? <time dateTime={item.latestChangeAt}>{formatDate(item.latestChangeAt)}</time> : '—'}</td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.latestChangeContent?.trim() || '—'}</td>
    <td className="max-w-xs whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.remark?.trim() || '未填写'}</td>
    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3"><DetailButton id={item.id} /></td>
  </tr>)}</tbody></table>;
}

function IssueTable({ items }: { items: Issue[] }) {
  return <table className="w-max min-w-full text-sm"><TableHeader labels={['问题标题', '问题描述', '状态', '优先级', '来源工作流', '分支', '操作']} /><tbody>{items.map(item => <tr key={item.id} className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-3 font-medium"><Link to={`/work-items/${item.id}`} className="text-foreground no-underline hover:text-primary">{item.title}</Link></td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description?.trim() || '未填写'}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="secondary">{formatIssueStatus(item.status)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.sourceWorkflowRun?.id ? <Link className="text-primary hover:underline" to={`/workflow-runs/${item.sourceWorkflowRun.id}`}>查看来源流程</Link> : '未关联'}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.branchName || '未记录'}</td>
    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3"><DetailButton id={item.id} /></td>
  </tr>)}</tbody></table>;
}

function BugTable({ items }: { items: Bug[] }) {
  return <table className="w-max min-w-full text-sm"><TableHeader labels={['缺陷标题', '缺陷描述', '严重级别', '优先级', '状态', '来源工作流', '分支', '操作']} /><tbody>{items.map(item => <tr key={item.id} className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-3 font-medium"><Link to={`/work-items/${item.id}`} className="text-foreground no-underline hover:text-primary">{item.title}</Link></td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description?.trim() || '未填写'}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="destructive">{formatSeverity(item.severity)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="secondary">{formatBugStatus(item.status)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.workflowRun?.id ? <Link className="text-primary hover:underline" to={`/workflow-runs/${item.workflowRun.id}`}>查看来源流程</Link> : '未关联'}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.branchName || '未记录'}</td>
    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3"><DetailButton id={item.id} /></td>
  </tr>)}</tbody></table>;
}

function AllWorkItemsTable({ items }: { items: WorkItem[] }) {
  return <table className="w-max min-w-full text-sm"><TableHeader labels={['类型', '标题', '描述', '状态', '优先级', '负责人', '更新时间', '操作']} /><tbody>{items.map(item => <tr key={item.id} className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="outline">{item.kind === 'REQUIREMENT' ? '需求' : item.kind === 'BUG' ? '缺陷' : '问题'}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3 font-medium"><Link to={`/work-items/${item.id}`} className="text-foreground no-underline hover:text-primary">{item.title}</Link></td>
    <td className="max-w-md whitespace-normal break-words px-4 py-3 text-muted-foreground">{item.description?.trim() || '未填写'}</td>
    <td className="whitespace-nowrap px-4 py-3"><Badge variant="secondary">{formatWorkItemStatus(item)}</Badge></td>
    <td className="whitespace-nowrap px-4 py-3">{formatPriority(item.priority)}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.ownerUser?.displayName || '未指定'}</td>
    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(item.updatedAt)}</td>
    <td className="sticky right-0 z-10 whitespace-nowrap border-l border-t border-border bg-card px-4 py-3"><DetailButton id={item.id} /></td>
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
  const [items, setItems] = useState<WorkItem[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [typedPage, setTypedPage] = useState(1);
  const [typedTotal, setTypedTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ kind: 'REQUIREMENT' as WorkItem['kind'], title: '', description: '', remark: '', splitMode: 'AI' as 'AI' | 'SINGLE' | 'MANUAL' });

  function clearLists() {
    setItems([]); setRequirements([]); setIssues([]); setBugs([]);
    setCursor(undefined); setNextCursor(null); setTypedPage(1); setTypedTotal(0);
  }

  async function load(next?: string | number) {
    if (!projectId || !versionId) return;
    const epoch = ++requestEpoch.current;
    setLoading(true);
    setError('');
    try {
      if (kind === 'ALL') {
        const result = await api.listVersionWorkItems(projectId, versionId, { cursor: typeof next === 'string' ? next : undefined, q: q.trim() || undefined, pageSize: PAGE_SIZE });
        if (epoch !== requestEpoch.current) return;
        setItems(result.items); setNextCursor(result.nextCursor); setCursor(typeof next === 'string' ? next : undefined);
      } else {
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
      await load(kind === 'ALL' ? undefined : typedPage);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '创建工作项失败');
    }
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
    if (nextKind === 'ALL') next.delete('kind'); else next.set('kind', nextKind);
    setSearchParams(next);
  }

  function openCreate() {
    setDraft(current => ({ ...current, kind: kind === 'ALL' ? current.kind : kind }));
    setCreateOpen(true);
  }

  const visibleItems = kind === 'ALL' ? items : kind === 'REQUIREMENT' ? requirements : kind === 'ISSUE' ? issues : bugs;
  const emptyDescription = kind === 'ALL' ? '当前版本还没有需求、问题或缺陷。' : kind === 'REQUIREMENT' ? '当前版本还没有需求。' : kind === 'ISSUE' ? '当前版本还没有问题。' : '当前版本还没有缺陷。';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Version work items"
        title="版本工作台"
        description="统一查看需求、问题和缺陷，编辑请进入工作项详情。"
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
            search={<Input className="max-w-xs" placeholder="搜索标题或描述" value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(kind === 'ALL' ? undefined : 1); }} />}
            filters={<Button variant="outline" onClick={() => void load(kind === 'ALL' ? undefined : 1)}>查询</Button>}
          />
          {error ? <p role="alert" className="text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={() => void load(kind === 'ALL' ? undefined : typedPage)}>重试</Button></p> : null}
          {loading && visibleItems.length === 0 ? <div className="flex min-h-40 items-center justify-center"><Spinner className="h-7 w-7" /></div> : visibleItems.length > 0 ? <div className="overflow-x-auto rounded-md border border-border">{kind === 'ALL' ? <AllWorkItemsTable items={items} /> : kind === 'REQUIREMENT' ? <RequirementTable items={requirements} /> : kind === 'ISSUE' ? <IssueTable items={issues} /> : <BugTable items={bugs} />}</div> : <EmptyState description={emptyDescription} />}
          {kind === 'ALL' ? <div className="flex justify-end gap-2 border-t border-border pt-4"><Button variant="outline" disabled={!cursor || loading} onClick={() => void load()}>回到第一页</Button><Button variant="outline" disabled={!nextCursor || loading} onClick={() => void load(nextCursor ?? undefined)}>下一页</Button></div> : <ListPagination page={typedPage} total={typedTotal} pageSize={PAGE_SIZE} loading={loading} onPageChange={page => void load(page)} label={`${kind === 'REQUIREMENT' ? '需求' : kind === 'ISSUE' ? '问题' : '缺陷'}列表分页`} />}
        </CardContent>
      </Card>
      {createOpen ? <Card><CardContent className="grid gap-3 p-4 md:grid-cols-2"><Select value={draft.kind} onValueChange={value => setDraft(current => ({ ...current, kind: value as WorkItem['kind'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="REQUIREMENT">需求</SelectItem><SelectItem value="ISSUE">问题</SelectItem><SelectItem value="BUG">缺陷</SelectItem></SelectContent></Select><p className="flex items-center text-sm text-muted-foreground">创建后由 AI 判断是否需要拆分，确认前不会派发执行项。</p><Input className="md:col-span-2" placeholder="标题" value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /><Textarea className="md:col-span-2" placeholder="会议记录或描述" value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /><Input className="md:col-span-2" placeholder="备注" value={draft.remark} onChange={event => setDraft(current => ({ ...current, remark: event.target.value }))} /><div className="flex gap-2 md:col-span-2"><Button onClick={() => void create()}>创建</Button><Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button></div></CardContent></Card> : null}
    </div>
  );
}
