import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { withCurrentProject } from '../project-scope';
import { SectionHeader } from './SectionHeader';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import { formatBeijingDateTime } from '../utils/datetime';
import type { ProjectFeed } from '../types';
import { ListPagination } from './ListPagination';
import { useQualityPage } from '../pages/quality/use-quality-page';

type FeedKind = 'briefing' | 'codeReview';

const copy = {
  briefing: {
    eyebrow: 'Briefings',
    title: '简报',
    empty: '还没有简报。新建后勾选工作区仓库，到点会按这一份生成并投递。',
    history: '/briefings',
    historyLabel: '查看历史',
  },
  codeReview: {
    eyebrow: 'Code Review',
    title: '代码审查',
    empty: '还没有代码审查。新建后勾选工作区仓库，到点会只审查这一份里的仓库。',
    history: '/code-reviews',
    historyLabel: '查看历史',
  },
} as const;

export function ProjectFeedsPanel({
  projectId,
  kind,
  workspaceId,
}: {
  projectId: string;
  kind: FeedKind;
  workspaceId: string;
}) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const result = useQualityPage(JSON.stringify([projectId, kind, page, query]), () => (kind === 'briefing' ? api.listBriefingFeeds : api.listCodeReviewFeeds)(projectId, { page, pageSize: 20, q: query || undefined }), true, setPage);
  const feeds = result.items;
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const text = copy[kind];

  async function refresh() { await result.refresh(); }

  useEffect(() => { setPage(1); setQuery(''); }, [projectId, kind]);

  async function createFeed() {
    const nextName = name.trim();
    if (!nextName) {
      toast.error('请填写名称');
      return;
    }
    setCreating(true);
    try {
      if (kind === 'briefing') {
        await api.createBriefingFeed(projectId, { name: nextName });
      } else {
        await api.createCodeReviewFeed(projectId, { name: nextName });
      }
      setName('');
      await refresh();
      toast.success('已创建');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="rounded-md border border-border bg-card">
      <CardHeader className="pb-4">
        <SectionHeader
          eyebrow={text.eyebrow}
          title={text.title}
          description="每一份单独选择工作区仓库、发送时刻和投递目标。工作区新增的仓库不会自动加入已有份。"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-5 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-48"
            value={name}
            placeholder="名称"
            aria-label={`${text.title}名称`}
            onChange={(event) => setName(event.target.value)}
          />
          <Button onClick={() => void createFeed()} disabled={creating}>
            新建
          </Button>
          <Button variant="outline" asChild>
            <Link to={withCurrentProject(text.history, projectId)}>{text.historyLabel}</Link>
          </Button>
        </div>
        <Input aria-label="搜索配置" placeholder="搜索配置" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        {result.error ? <p role="alert">{result.error}<Button variant="outline" onClick={() => void refresh()}>重试</Button></p> : null}
        {result.loading ? <p>加载中…</p> : result.hasLoaded && feeds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{text.empty}</p>
        ) : (
          feeds.map((feed) => (
            <FeedEditor
              key={feed.id}
              kind={kind}
              feed={feed}
              workspaceId={workspaceId}
              onChanged={refresh}
            />
          ))
        )}
        <ListPagination page={page} total={result.total} loading={result.refreshing} onPageChange={setPage} label="配置列表分页" />
      </CardContent>
    </Card>
  );
}

function FeedEditor({
  kind,
  feed,
  workspaceId,
  onChanged,
}: {
  kind: FeedKind;
  feed: ProjectFeed;
  workspaceId: string;
  onChanged: () => Promise<void>;
}) {
  const [hour, setHour] = useState(String(feed.dailyHour));
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [repoPage, setRepoPage] = useState(1);
  const [repoQuery, setRepoQuery] = useState('');
  const [targetPage, setTargetPage] = useState(1);
  const [targetQuery, setTargetQuery] = useState('');
  const repositoryResult = useQualityPage(JSON.stringify([workspaceId, repoPage, repoQuery]), () => api.getWorkspaceRepositories(workspaceId, { page: repoPage, pageSize: 20, q: repoQuery || undefined }), true, setRepoPage);
  const targetResult = useQualityPage(JSON.stringify([feed.projectId, kind, targetPage, targetQuery]), () => api.getDeliveryTargets({ projectId: feed.projectId, purpose: kind, page: targetPage, pageSize: 20, q: targetQuery || undefined }), true, setTargetPage);
  const repositories = repositoryResult.items;
  const visibleTargets = targetResult.items;
  const unassigned = repositories.filter((repository) => !feed.repositoryIds.includes(repository.id));

  useEffect(() => {
    setHour(String(feed.dailyHour));
  }, [feed.dailyHour]);

  async function save(payload: Parameters<typeof api.updateBriefingFeed>[1]) {
    setSaving(true);
    try {
      if (kind === 'briefing') {
        await api.updateBriefingFeed(feed.id, payload);
      } else {
        await api.updateCodeReviewFeed(feed.id, payload);
      }
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function toggleId(current: string[], id: string) {
    return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-40"
          aria-label="名称"
          defaultValue={feed.name}
          key={feed.name}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next && next !== feed.name) {
              void save({ name: next });
            }
          }}
        />
        <Button
          variant={feed.enabled ? 'default' : 'outline'}
          disabled={saving}
          onClick={() => void save({ enabled: !feed.enabled })}
        >
          {feed.enabled ? '定时已开启' : '开启定时'}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>北京时间</span>
          <Input
            className="w-20"
            type="number"
            min={0}
            max={23}
            aria-label="发送小时"
            value={hour}
            onChange={(event) => setHour(event.target.value)}
            onBlur={() => {
              const nextHour = Number(hour);
              if (!Number.isInteger(nextHour) || nextHour < 0 || nextHour > 23) {
                setHour(String(feed.dailyHour));
                toast.error('请输入 0–23 之间的整点小时');
                return;
              }
              if (nextHour !== feed.dailyHour) {
                void save({ dailyHour: nextHour });
              }
            }}
          />
          <span>时</span>
        </label>
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => void saveDelete()}
        >
          删除
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">仓库 · 已选 {feed.repositoryIds.length} 个</span>
        <Input aria-label="搜索工作区仓库" placeholder="搜索工作区仓库" value={repoQuery} onChange={(event) => { setRepoQuery(event.target.value); setRepoPage(1); }} />
        {repositoryResult.error ? <p role="alert">{repositoryResult.error}<Button variant="outline" onClick={() => void repositoryResult.refresh()}>重试</Button></p> : null}
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">工作区还没有仓库。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {repositories.map((repository) => {
              const selected = feed.repositoryIds.includes(repository.id);
              return (
                <Button
                  key={repository.id}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => void save({ repositoryIds: toggleId(feed.repositoryIds, repository.id) })}
                >
                  {repository.name}
                </Button>
              );
            })}
          </div>
        )}
        {unassigned.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            本页尚未加入：{unassigned.map((repository) => repository.name).join('、')}
          </p>
        ) : null}
        <ListPagination page={repoPage} total={repositoryResult.total} loading={repositoryResult.refreshing} onPageChange={setRepoPage} label="仓库候选分页" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">投递目标 · 已选 {feed.deliveryTargetIds.length} 个</span>
        <Input aria-label="搜索投递目标" placeholder="搜索投递目标" value={targetQuery} onChange={(event) => { setTargetQuery(event.target.value); setTargetPage(1); }} />
        {targetResult.error ? <p role="alert">{targetResult.error}<Button variant="outline" onClick={() => void targetResult.refresh()}>重试</Button></p> : null}
        {visibleTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">当前项目还没有可用的投递目标。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleTargets.map((target) => {
              const selected = feed.deliveryTargetIds.includes(target.id);
              return (
                <Button
                  key={target.id}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => void save({
                    deliveryTargetIds: toggleId(feed.deliveryTargetIds, target.id),
                  })}
                >
                  {target.name}
                </Button>
              );
            })}
          </div>
        )}
        <ListPagination page={targetPage} total={targetResult.total} loading={targetResult.refreshing} onPageChange={setTargetPage} label="投递目标候选分页" />
      </div>
      {feed.enabled ? (
        <p className="text-sm text-muted-foreground">
          上次定时执行：{formatBeijingDateTime(feed.lastSchedulerRunAt)}
          {feed.lastSchedulerMessage ? ` · ${feed.lastSchedulerMessage}` : ''}
        </p>
      ) : null}
    </div>
  );

  async function saveDelete() {
    setSaving(true);
    try {
      if (kind === 'briefing') {
        await api.deleteBriefingFeed(feed.id);
      } else {
        await api.deleteCodeReviewFeed(feed.id);
      }
      await onChanged();
      toast.success('已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setSaving(false);
    }
  }
}
