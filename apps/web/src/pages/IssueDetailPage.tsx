import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ContextPanel } from '../components/ContextPanel';
import { DetailHeader } from '../components/DetailHeader';
import { MetricCard } from '../components/MetricCard';
import { SectionHeader } from '../components/SectionHeader';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input as UiInput } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import type { Issue } from '../types';
import {
  formatIssueStatus,
  formatPriority,
  formatPriorityLabel,
  formatReviewFindingType,
  formatSeverity,
} from '../utils/label-utils';

export function IssueDetailPage() {
  const { issueId = '' } = useParams();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    variant: 'default' | 'destructive';
    title: string;
    description: string;
  } | null>(null);
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    status: 'OPEN',
    priority: 'MEDIUM',
    branchName: '',
    resolution: '',
  });
  const toast = useToast();

  async function refresh() {
    if (!issueId) {
      return;
    }
    setLoading(true);
    try {
      const nextIssue = await api.getIssue(issueId);
      setIssue(nextIssue);
      setDraft({
        title: nextIssue.title,
        description: nextIssue.description,
        status: nextIssue.status,
        priority: nextIssue.priority,
        branchName: nextIssue.branchName ?? '',
        resolution: nextIssue.resolution ?? '',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载问题项详情失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [issueId]);

  async function submit(values: {
    title: string;
    description: string;
    status: string;
    priority: string;
    branchName?: string;
    resolution?: string;
  }) {
    if (!issueId) {
      return;
    }
    setSaving(true);
    try {
      const nextIssue = await api.updateIssue(issueId, values);
      setIssue(nextIssue);
      setDraft({
        title: nextIssue.title,
        description: nextIssue.description,
        status: nextIssue.status,
        priority: nextIssue.priority,
        branchName: nextIssue.branchName ?? '',
        resolution: nextIssue.resolution ?? '',
      });
      setSaveFeedback({
        variant: 'default',
        title: '保存成功',
        description: '问题项信息已更新，你可以继续修改或返回列表查看。',
      });
      toast.success('问题项已更新');
    } catch (error) {
      setSaveFeedback({
        variant: 'destructive',
        title: '保存失败',
        description: error instanceof Error ? error.message : '更新问题项失败',
      });
      toast.error(error instanceof Error ? error.message : '更新问题项失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim() || !draft.description.trim()) {
      setSaveFeedback({
        variant: 'destructive',
        title: '保存失败',
        description: '请完整填写标题和描述。',
      });
      toast.error('请完整填写标题和描述');
      return;
    }

    await submit({
      title: draft.title.trim(),
      description: draft.description.trim(),
      status: draft.status,
      priority: draft.priority,
      branchName: draft.branchName.trim() || undefined,
      resolution: draft.resolution.trim() || undefined,
    });
  }

  if (!issueId) {
    return <Navigate to="/issues" replace />;
  }

  return (
    <>
      <div className="flex flex-col gap-[18px]">
        <DetailHeader
          eyebrow="Issue Detail"
          title={issue?.title ?? '问题项详情'}
          description="查看并维护问题项的当前状态、优先级和来源信息。"
          badges={[
            { key: 'workspace', label: issue?.workspace?.name ?? '未绑定工作区', variant: 'default' },
            { key: 'priority', label: formatPriorityLabel(issue?.priority ?? 'MEDIUM'), variant: 'outline' },
            { key: 'status', label: formatIssueStatus(issue?.status ?? 'OPEN'), variant: 'secondary' },
          ]}
          actions={
            <>
              <UiButton variant="outline" asChild>
                <Link to="/issues">返回问题项列表</Link>
              </UiButton>
              {issue?.workflowRun?.id ? (
                <UiButton variant="outline" asChild>
                  <Link to={`/workflow-runs/${issue.workflowRun.id}`}>查看来源流程</Link>
                </UiButton>
              ) : null}
            </>
          }
        />

        <div className="grid gap-5 md:grid-cols-4">
          <MetricCard label="当前状态" value={formatIssueStatus(issue?.status ?? 'OPEN')} helpText="问题项当前所处的处理阶段。" />
          <MetricCard label="优先级" value={formatPriority(issue?.priority ?? 'MEDIUM')} helpText="用于标记后续处理和排期的紧急程度。" />
          <MetricCard label="所属工作区" value={issue?.workspace?.name ?? '未绑定'} helpText="当前问题项所属的项目空间。" />
          <MetricCard
            label="来源流程"
            value={issue?.workflowRun ? '已关联' : '未关联'}
            helpText={issue?.workflowRun ? '可追溯到原始工作流与审查上下文。' : '当前未记录来源工作流。'}
          />
        </div>

        <div className="grid items-start gap-5 min-[1281px]:grid-cols-[minmax(0,1.5fr)_360px] max-[1280px]:grid-cols-1">
          <div className="flex flex-col gap-[18px]">
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-4">
                <SectionHeader eyebrow="Edit Issue" title="编辑问题项" />
              </CardHeader>
              <CardContent className="p-5 pt-0">
                {loading ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Spinner className="h-7 w-7" />
                  </div>
                ) : (
              <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
                {saveFeedback ? (
                  <Alert variant={saveFeedback.variant} className="mb-1">
                    <AlertTitle>{saveFeedback.title}</AlertTitle>
                    <AlertDescription>{saveFeedback.description}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[var(--text)]" htmlFor="issue-title">标题</label>
                  <UiInput
                    id="issue-title"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[var(--text)]" htmlFor="issue-description">描述</label>
                  <Textarea
                    id="issue-description"
                    rows={6}
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </div>
                <div className="inline-filter-group">
                  <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                    <label className="text-sm font-semibold text-[var(--text)]">状态</label>
                    <Select value={draft.status} onValueChange={(value) => setDraft((current) => ({ ...current, status: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OPEN">{formatIssueStatus('OPEN')}</SelectItem>
                        <SelectItem value="IN_PROGRESS">{formatIssueStatus('IN_PROGRESS')}</SelectItem>
                        <SelectItem value="RESOLVED">{formatIssueStatus('RESOLVED')}</SelectItem>
                        <SelectItem value="CLOSED">{formatIssueStatus('CLOSED')}</SelectItem>
                        <SelectItem value="WONT_FIX">{formatIssueStatus('WONT_FIX')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                    <label className="text-sm font-semibold text-[var(--text)]">优先级</label>
                    <Select value={draft.priority} onValueChange={(value) => setDraft((current) => ({ ...current, priority: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">{formatPriority('LOW')}</SelectItem>
                        <SelectItem value="MEDIUM">{formatPriority('MEDIUM')}</SelectItem>
                        <SelectItem value="HIGH">{formatPriority('HIGH')}</SelectItem>
                        <SelectItem value="URGENT">{formatPriority('URGENT')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[var(--text)]" htmlFor="issue-branch">分支</label>
                  <UiInput
                    id="issue-branch"
                    value={draft.branchName}
                    onChange={(event) => setDraft((current) => ({ ...current, branchName: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-[var(--text)]" htmlFor="issue-resolution">处理结论</label>
                  <Textarea
                    id="issue-resolution"
                    rows={4}
                    value={draft.resolution}
                    onChange={(event) => setDraft((current) => ({ ...current, resolution: event.target.value }))}
                  />
                </div>
                <UiButton type="submit" disabled={saving} className="self-start min-w-[120px]">
                  保存变更
                </UiButton>
              </form>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-[18px]">
            <ContextPanel
              eyebrow="Source"
              title="来源上下文"
              description="回看当前问题项来自哪条需求、哪个分支以及哪一条审查结论。"
            >
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">来源需求</div>
                  <div className="break-words text-sm font-medium text-slate-900">{issue?.requirement?.title ?? '未关联需求'}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">来源分支</div>
                  <div className="break-all text-sm font-medium text-slate-900">{issue?.branchName ?? '未记录分支'}</div>
                </div>
              {issue?.reviewFinding ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant="default">{formatReviewFindingType(issue.reviewFinding.type)}</Badge>
                    <Badge variant="outline">{formatSeverity(issue.reviewFinding.severity)}</Badge>
                  </div>
                  <p className="break-words text-sm leading-6 text-slate-600">{issue.reviewFinding.description}</p>
                </div>
              ) : null}
              </div>
            </ContextPanel>
          </div>
        </div>
      </div>
    </>
  );
}
