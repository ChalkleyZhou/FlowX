import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, getBugScreenshotUrl } from '../api';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { ImageAttachmentPicker } from '../components/ImageAttachmentPicker';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import type { Bug, Workspace } from '../types';
import {
  type PendingImageAttachment,
  releaseImageAttachmentPreviews,
  toImageAttachmentPayload,
} from '../utils/image-attachments';
import {
  formatBugStatus,
  formatPriority,
  formatPriorityLabel,
  formatReviewFindingType,
  formatSeverity,
  formatSeverityLabel,
} from '../utils/label-utils';

const AI_PROVIDER_STORAGE_KEY = 'flowx-default-ai-provider';

export function BugDetailPage() {
  const { bugId = '' } = useParams();
  const navigate = useNavigate();
  const [bug, setBug] = useState<Bug | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [fixModalOpen, setFixModalOpen] = useState(false);
  const [fixSubmitting, setFixSubmitting] = useState(false);
  const [fixRepositoryIds, setFixRepositoryIds] = useState<string[]>([]);
  const [fixAiProvider, setFixAiProvider] = useState<'codex' | 'cursor'>('codex');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    variant: 'default' | 'destructive';
    title: string;
    description: string;
  } | null>(null);
  const [newAttachments, setNewAttachments] = useState<PendingImageAttachment[]>([]);
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    status: 'OPEN',
    severity: 'MEDIUM',
    priority: 'MEDIUM',
    branchName: '',
    expectedBehavior: '',
    actualBehavior: '',
    reproductionSteps: '',
    resolution: '',
  });
  const toast = useToast();

  const bugWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === bug?.workspace?.id) ?? null,
    [bug?.workspace?.id, workspaces],
  );
  const availableRepositories = bugWorkspace?.repositories ?? [];
  const canStartFixWorkflow =
    bug != null &&
    ['OPEN', 'CONFIRMED'].includes(bug.status) &&
    (!bug.fixWorkflowRun || ['DONE', 'FAILED'].includes(bug.fixWorkflowRun.status));

  async function refresh() {
    if (!bugId) {
      return;
    }
    setLoading(true);
    try {
      const nextBug = await api.getBug(bugId);
      setBug(nextBug);
      setDraft({
        title: nextBug.title,
        description: nextBug.description,
        status: nextBug.status,
        severity: nextBug.severity,
        priority: nextBug.priority,
        branchName: nextBug.branchName ?? '',
        expectedBehavior: nextBug.expectedBehavior ?? '',
        actualBehavior: nextBug.actualBehavior ?? '',
        reproductionSteps: (nextBug.reproductionSteps ?? []).join('\n'),
        resolution: nextBug.resolution ?? '',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载缺陷详情失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [bugId]);

  useEffect(() => {
    void (async () => {
      try {
        const [workspaceList, providerConfig] = await Promise.all([
          api.getWorkspaces(),
          api.getWorkflowProviders(),
        ]);
        setWorkspaces(workspaceList);
        const storedProvider =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY)
            : null;
        setFixAiProvider(
          storedProvider === 'cursor' || storedProvider === 'codex'
            ? storedProvider
            : providerConfig.defaultProvider,
        );
      } catch {
        // ignore — fix dialog can still open with defaults
      }
    })();
  }, []);

  useEffect(() => {
    if (!fixModalOpen || availableRepositories.length === 0) {
      return;
    }
    setFixRepositoryIds((current) =>
      current.length > 0 ? current : availableRepositories.map((repository) => repository.id),
    );
  }, [availableRepositories, fixModalOpen]);

  async function handleStartFixWorkflow() {
    if (!bugId) {
      return;
    }
    setFixSubmitting(true);
    try {
      const result = await api.startBugFixWorkflow(bugId, {
        repositoryIds: fixRepositoryIds,
        aiProvider: fixAiProvider,
        autoStart: true,
      });
      toast.success('已发起缺陷修复工作流，正在自动执行');
      setFixModalOpen(false);
      navigate(`/workflow-runs/${result.workflowRun.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发起修复工作流失败');
    } finally {
      setFixSubmitting(false);
    }
  }

  async function submit(values: {
    title: string;
    description: string;
    status: string;
    severity: string;
    priority: string;
    branchName?: string;
    expectedBehavior?: string;
    actualBehavior?: string;
    reproductionSteps?: string;
    resolution?: string;
    screenshots?: Array<{
      fileName: string;
      contentType: string;
      dataBase64: string;
    }>;
  }) {
    if (!bugId) {
      return;
    }
    setSaving(true);
    try {
      const nextBug = await api.updateBug(bugId, {
        ...values,
        reproductionSteps: values.reproductionSteps
          ? values.reproductionSteps.split('\n').map((item) => item.trim()).filter(Boolean)
          : [],
      });
      setBug(nextBug);
      setDraft({
        title: nextBug.title,
        description: nextBug.description,
        status: nextBug.status,
        severity: nextBug.severity,
        priority: nextBug.priority,
        branchName: nextBug.branchName ?? '',
        expectedBehavior: nextBug.expectedBehavior ?? '',
        actualBehavior: nextBug.actualBehavior ?? '',
        reproductionSteps: (nextBug.reproductionSteps ?? []).join('\n'),
        resolution: nextBug.resolution ?? '',
      });
      setSaveFeedback({
        variant: 'default',
        title: '保存成功',
        description: '缺陷信息已更新，你可以继续完善修复上下文或返回列表。',
      });
      toast.success('缺陷已更新');
    } catch (error) {
      setSaveFeedback({
        variant: 'destructive',
        title: '保存失败',
        description: error instanceof Error ? error.message : '更新缺陷失败',
      });
      toast.error(error instanceof Error ? error.message : '更新缺陷失败');
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
      severity: draft.severity,
      priority: draft.priority,
      branchName: draft.branchName.trim() || undefined,
      expectedBehavior: draft.expectedBehavior.trim() || undefined,
      actualBehavior: draft.actualBehavior.trim() || undefined,
      reproductionSteps: draft.reproductionSteps,
      resolution: draft.resolution.trim() || undefined,
      screenshots:
        newAttachments.length > 0 ? toImageAttachmentPayload(newAttachments) : undefined,
    });
    releaseImageAttachmentPreviews(newAttachments);
    setNewAttachments([]);
  }

  if (!bugId) {
    return <Navigate to="/bugs" replace />;
  }

  return (
    <>
      <div className="flex flex-col gap-[18px]">
        <DetailHeader
          eyebrow="Bug Detail"
          title={bug?.title ?? '缺陷详情'}
          description="查看并维护缺陷的当前状态、严重级别和来源信息。"
          badges={[
            { key: 'severity', label: formatSeverityLabel(bug?.severity ?? 'MEDIUM'), variant: 'destructive' },
            { key: 'priority', label: formatPriorityLabel(bug?.priority ?? 'MEDIUM'), variant: 'outline' },
            { key: 'status', label: formatBugStatus(bug?.status ?? 'OPEN'), variant: 'secondary' },
            { key: 'workspace', label: bug?.workspace?.name ?? '未绑定工作区', variant: 'default' },
          ]}
          actions={
            <>
              {canStartFixWorkflow ? (
                <UiButton onClick={() => setFixModalOpen(true)}>发起修复工作流</UiButton>
              ) : null}
              <UiButton variant="outline" asChild>
                <Link to="/bugs">返回缺陷列表</Link>
              </UiButton>
              {bug?.fixWorkflowRun?.id ? (
                <UiButton variant="outline" asChild>
                  <Link to={`/workflow-runs/${bug.fixWorkflowRun.id}`}>查看修复工作流</Link>
                </UiButton>
              ) : null}
              {bug?.workflowRun?.id ? (
                <UiButton variant="outline" asChild>
                  <Link to={`/workflow-runs/${bug.workflowRun.id}`}>查看来源流程</Link>
                </UiButton>
              ) : null}
            </>
          }
        />

        <div className="grid gap-5 md:grid-cols-4">
          <MetricCard label="当前状态" value={formatBugStatus(bug?.status ?? 'OPEN')} helpText="缺陷当前所处的处理阶段。" />
          <MetricCard label="严重级别" value={formatSeverity(bug?.severity ?? 'MEDIUM')} helpText="用于标记影响范围和风险等级。" />
          <MetricCard label="优先级" value={formatPriority(bug?.priority ?? 'MEDIUM')} helpText="用于安排修复顺序与处理节奏。" />
          <MetricCard label="所属工作区" value={bug?.workspace?.name ?? '未绑定'} helpText="当前缺陷所属的项目空间。" />
        </div>

        <div className="grid items-start gap-5 min-[1281px]:grid-cols-[minmax(0,1.5fr)_360px] max-[1280px]:grid-cols-1">
          <div className="flex flex-col gap-[18px]">
            <Card className="rounded-2xl border border-border bg-card shadow-sm">
              <CardHeader className="pb-4">
                <SectionHeader eyebrow="Edit Bug" title="编辑缺陷" />
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
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-title">标题</label>
                  <UiInput
                    id="bug-title"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-description">描述</label>
                  <Textarea
                    id="bug-description"
                    rows={5}
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                    <label className="text-sm font-semibold text-foreground">状态</label>
                    <Select value={draft.status} onValueChange={(value) => setDraft((current) => ({ ...current, status: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OPEN">{formatBugStatus('OPEN')}</SelectItem>
                        <SelectItem value="CONFIRMED">{formatBugStatus('CONFIRMED')}</SelectItem>
                        <SelectItem value="FIXING">{formatBugStatus('FIXING')}</SelectItem>
                        <SelectItem value="FIXED">{formatBugStatus('FIXED')}</SelectItem>
                        <SelectItem value="VERIFIED">{formatBugStatus('VERIFIED')}</SelectItem>
                        <SelectItem value="CLOSED">{formatBugStatus('CLOSED')}</SelectItem>
                        <SelectItem value="WONT_FIX">{formatBugStatus('WONT_FIX')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                    <label className="text-sm font-semibold text-foreground">严重级别</label>
                    <Select value={draft.severity} onValueChange={(value) => setDraft((current) => ({ ...current, severity: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOW">{formatSeverity('LOW')}</SelectItem>
                        <SelectItem value="MEDIUM">{formatSeverity('MEDIUM')}</SelectItem>
                        <SelectItem value="HIGH">{formatSeverity('HIGH')}</SelectItem>
                        <SelectItem value="CRITICAL">{formatSeverity('CRITICAL')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex min-w-[220px] flex-1 flex-col gap-2">
                    <label className="text-sm font-semibold text-foreground">优先级</label>
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
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-branch">分支</label>
                  <UiInput
                    id="bug-branch"
                    value={draft.branchName}
                    onChange={(event) => setDraft((current) => ({ ...current, branchName: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-expected">预期行为</label>
                  <Textarea
                    id="bug-expected"
                    rows={3}
                    value={draft.expectedBehavior}
                    onChange={(event) => setDraft((current) => ({ ...current, expectedBehavior: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-actual">实际行为</label>
                  <Textarea
                    id="bug-actual"
                    rows={3}
                    value={draft.actualBehavior}
                    onChange={(event) => setDraft((current) => ({ ...current, actualBehavior: event.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-reproduction">复现步骤</label>
                  <Textarea
                    id="bug-reproduction"
                    rows={5}
                    value={draft.reproductionSteps}
                    onChange={(event) => setDraft((current) => ({ ...current, reproductionSteps: event.target.value }))}
                    placeholder="每行一步"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-foreground" htmlFor="bug-resolution">处理结论</label>
                  <Textarea
                    id="bug-resolution"
                    rows={4}
                    value={draft.resolution}
                    onChange={(event) => setDraft((current) => ({ ...current, resolution: event.target.value }))}
                  />
                </div>
                {bug?.screenshots && bug.screenshots.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-foreground">已有截图</label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {bug.screenshots.map((screenshot) => (
                        <div
                          key={screenshot.id}
                          className="overflow-hidden rounded-xl border border-border bg-muted/30"
                        >
                          <AuthenticatedImage
                            src={getBugScreenshotUrl(bug.id, screenshot.id)}
                            alt={screenshot.fileName}
                            className="h-40 w-full object-cover"
                          />
                          <div className="border-t border-border px-3 py-2 text-sm text-muted-foreground">
                            {screenshot.fileName}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <ImageAttachmentPicker
                  attachments={newAttachments}
                  existingCount={bug?.screenshots?.length ?? 0}
                  onChange={setNewAttachments}
                  onError={(message) => toast.error(message)}
                  disabled={saving}
                  label="补充截图"
                  description="保存后会追加到当前缺陷，支持继续选择或粘贴图片。"
                />
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
              eyebrow="Fix"
              title="修复上下文"
              description="查看缺陷关联的修复需求与修复工作流。"
            >
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    修复需求
                  </div>
                  <div className="break-words text-sm font-medium text-foreground">
                    {bug?.fixRequirement?.title ?? '尚未发起修复'}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    修复工作流
                  </div>
                  <div className="break-words text-sm font-medium text-foreground">
                    {bug?.fixWorkflowRun
                      ? `${formatBugStatus(bug.fixWorkflowRun.status)} · ${bug.fixWorkflowRun.id}`
                      : '尚未创建'}
                  </div>
                </div>
              </div>
            </ContextPanel>

            <ContextPanel
              eyebrow="Source"
              title="来源上下文"
              description="回看当前缺陷对应的原始需求、分支以及 AI 审查结论。"
            >
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">来源需求</div>
                  <div className="break-words text-sm font-medium text-foreground">{bug?.requirement?.title ?? '未关联需求'}</div>
                </div>
                <div className="rounded-lg border border-border bg-muted p-4">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">来源分支</div>
                  <div className="break-all text-sm font-medium text-foreground">{bug?.branchName ?? '未记录分支'}</div>
                </div>
              {bug?.reviewFinding ? (
                <div className="rounded-lg border border-border bg-muted p-4">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge variant="default">{formatReviewFindingType(bug.reviewFinding.type)}</Badge>
                    <Badge variant="outline">{formatSeverity(bug.reviewFinding.severity)}</Badge>
                  </div>
                  <p className="break-words text-sm leading-6 text-muted-foreground">{bug.reviewFinding.description}</p>
                </div>
              ) : null}
              </div>
            </ContextPanel>
          </div>
        </div>
      </div>

      <Dialog open={fixModalOpen} onOpenChange={setFixModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>发起修复工作流</DialogTitle>
            <DialogDescription>
              将跳过构思、设计、任务拆解与技术方案阶段，在仓库准备完成后自动开始研发执行与审查。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">AI 执行器</label>
              <Select
                value={fixAiProvider}
                onValueChange={(value) => setFixAiProvider(value as 'codex' | 'cursor')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="codex">Codex</SelectItem>
                  <SelectItem value="cursor">Cursor CLI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-foreground">目标仓库</label>
              <div className="flex flex-col gap-2">
                {availableRepositories.map((repository) => {
                  const checked = fixRepositoryIds.includes(repository.id);
                  return (
                    <label
                      key={repository.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setFixRepositoryIds((current) =>
                            checked
                              ? current.filter((id) => id !== repository.id)
                              : [...current, repository.id],
                          );
                        }}
                      />
                      <span>{repository.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <UiButton
              disabled={fixSubmitting || fixRepositoryIds.length === 0}
              onClick={() => void handleStartFixWorkflow()}
            >
              {fixSubmitting ? '发起中...' : '确认并自动开始修复'}
            </UiButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
