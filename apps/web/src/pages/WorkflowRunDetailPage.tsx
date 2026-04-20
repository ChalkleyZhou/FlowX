import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ContextPanel } from '../components/ContextPanel';
import { DiffFileListPanel } from '../components/DiffFileListPanel';
import { DiffViewerPanel } from '../components/DiffViewerPanel';
import { EmptyState } from '../components/EmptyState';
import { DetailHeader } from '../components/DetailHeader';
import { MetricCard } from '../components/MetricCard';
import { SectionHeader } from '../components/SectionHeader';
import { StatPill } from '../components/StatPill';
import { StageCard } from '../components/StageCard';
import { ReviewFindingCard } from '../components/ReviewFindingCard';
import { WorkflowReviewSidebar, type WorkflowWorkspaceAction } from '../components/WorkflowReviewSidebar';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input as UiInput } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useToast } from '../components/ui/toast';
import type { RepositoryDeployConfig, WorkflowRun } from '../types';
import { formatStageExecutionStatus, formatWorkflowStatus, getStage } from '../utils/workflow-ui';

const STAGE_SEQUENCE = ['REPOSITORY_GROUNDING', 'TASK_SPLIT', 'TECHNICAL_PLAN', 'EXECUTION', 'AI_REVIEW'] as const;

type WorkflowStageKey = (typeof STAGE_SEQUENCE)[number];
type EditableStage = 'task-split' | 'plan' | 'execution' | 'review';

interface StageActionView {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  variant?: 'primary' | 'default';
}

interface WorkflowWorkspaceConfig {
  stage: EditableStage;
  title: string;
  helperText: string;
  statusLabel?: string;
  feedbackPlaceholder: string;
  primaryAction: WorkflowWorkspaceAction;
  secondaryActions: WorkflowWorkspaceAction[];
}

interface StageDetailView {
  title: string;
  subtitle: string;
  status?: string;
  statusMessage?: string | null;
  attempt?: number;
  output?: unknown;
  actions: StageActionView[];
}

interface DiffArtifactView {
  repository: string;
  branch: string;
  localPath: string;
  diffStat: string;
  diffText: string;
  untrackedFiles: string[];
}

interface DiffFileView {
  key: string;
  path: string;
  kind: 'modified' | 'untracked';
  diffText: string;
}

interface RepositoryPathContext {
  name: string;
  localPath?: string | null;
}

interface PublishRepositorySummary {
  repository: string;
  branch: string;
  commitSha: string;
  pushed: boolean;
  verified: boolean;
  remoteUrl: string;
}

interface DeployDraft {
  repositoryId: string;
  repositoryName: string;
  env: string;
  branch: string;
  commit: string;
  version: string;
  versionImage: string;
  image: string;
}

const stageMeta: Record<
  WorkflowStageKey,
  { title: string; stepLabel: string; stageNo: string; editableStage: EditableStage }
> = {
  REPOSITORY_GROUNDING: {
    title: '仓库 Grounding',
    stepLabel: '仓库 Grounding',
    stageNo: '阶段 2',
    editableStage: 'task-split',
  },
  TASK_SPLIT: {
    title: '任务拆解',
    stepLabel: '任务拆解',
    stageNo: '阶段 3',
    editableStage: 'task-split',
  },
  TECHNICAL_PLAN: {
    title: '技术方案',
    stepLabel: '技术方案',
    stageNo: '阶段 4',
    editableStage: 'plan',
  },
  EXECUTION: {
    title: '开发执行',
    stepLabel: '开发执行',
    stageNo: '阶段 5',
    editableStage: 'execution',
  },
  AI_REVIEW: {
    title: 'AI 审查',
    stepLabel: 'AI 审查',
    stageNo: '阶段 6',
    editableStage: 'review',
  },
};

function buildWorkflowSnapshot(value: WorkflowRun | null) {
  return JSON.stringify(value);
}

function getStepVisualStatus(stageStatus?: string): 'wait' | 'process' | 'finish' | 'error' {
  switch (stageStatus) {
    case 'COMPLETED':
      return 'finish';
    case 'RUNNING':
    case 'WAITING_CONFIRMATION':
      return 'process';
    case 'FAILED':
    case 'REJECTED':
      return 'error';
    default:
      return 'wait';
  }
}

function getStepDescription(stage?: { status?: string; statusMessage?: string | null }) {
  if (!stage?.status) {
    return '尚未开始';
  }

  if ((stage.status === 'RUNNING' || stage.status === 'FAILED') && stage.statusMessage?.trim()) {
    return stage.statusMessage.trim();
  }

  return formatStageExecutionStatus(stage.status);
}

function inferFocusedStage(run: WorkflowRun): WorkflowStageKey {
  for (const stageKey of STAGE_SEQUENCE) {
    const stage = getStage(run, stageKey);
    if (stage?.status === 'RUNNING' || stage?.status === 'WAITING_CONFIRMATION' || stage?.status === 'FAILED') {
      return stageKey;
    }
  }

  if (run.status === 'REPOSITORY_GROUNDING_PENDING') {
    return 'REPOSITORY_GROUNDING';
  }

  if (run.status === 'PLAN_PENDING' || run.status === 'PLAN_WAITING_CONFIRMATION' || run.status === 'PLAN_CONFIRMED') {
    return 'TECHNICAL_PLAN';
  }

  if (run.status === 'EXECUTION_PENDING' || run.status === 'EXECUTION_RUNNING' || run.status === 'REVIEW_PENDING') {
    return 'EXECUTION';
  }

  if (run.status === 'HUMAN_REVIEW_PENDING' || run.status === 'DONE') {
    return 'AI_REVIEW';
  }

  return 'TASK_SPLIT';
}

function splitDiffTextIntoFiles(diffText: string): DiffFileView[] {
  if (!diffText.trim()) {
    return [];
  }

  const chunks = diffText
    .split(/(?=^diff --git )/gm)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk, index) => {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? header?.[1] ?? `变更文件 ${index + 1}`;

    return {
      key: `modified-${path}-${index}`,
      path,
      kind: 'modified' as const,
      diffText: chunk,
    };
  });
}

function sanitizeDisplayPathString(value: string, repositories: RepositoryPathContext[]) {
  const text = value.trim();
  if (!text) {
    return text;
  }

  const normalizedText = text.replace(/\\/g, '/');

  const repoContexts = repositories
    .filter((repository) => repository.localPath)
    .map((repository) => ({
      name: repository.name,
      localPath: String(repository.localPath).replace(/\\/g, '/').replace(/\/+$/, ''),
    }))
    .sort((a, b) => b.localPath.length - a.localPath.length);

  for (const repository of repoContexts) {
    if (normalizedText === repository.localPath || normalizedText.startsWith(`${repository.localPath}/`)) {
      const relativePath = normalizedText.slice(repository.localPath.length).replace(/^\/+/, '');
      if (!relativePath) {
        return repoContexts.length > 1 ? `${repository.name}:.` : '.';
      }
      return repoContexts.length > 1 ? `${repository.name}:${relativePath}` : relativePath;
    }
  }

  if (normalizedText.startsWith('/Users/') || normalizedText.startsWith('/tmp/') || /^[A-Za-z]:\//.test(normalizedText)) {
    return '已隐藏本地绝对路径';
  }

  return text;
}

function sanitizeDisplayValue(value: unknown, repositories: RepositoryPathContext[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayValue(item, repositories));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      if (key === 'localPath') {
        return acc;
      }
      acc[key] = sanitizeDisplayValue(entry, repositories);
      return acc;
    }, {});
  }

  if (typeof value === 'string') {
    return sanitizeDisplayPathString(value, repositories);
  }

  return value;
}

export function WorkflowRunDetailPage() {
  const { workflowRunId = '' } = useParams();
  const navigate = useNavigate();
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStage, setSelectedStage] = useState<WorkflowStageKey>('TASK_SPLIT');
  const [branchSummaryExpanded, setBranchSummaryExpanded] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<'feedback' | null>(null);
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null);
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [selectedDiffFileKey, setSelectedDiffFileKey] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deploySubmitting, setDeploySubmitting] = useState(false);
  const [deployConfig, setDeployConfig] = useState<RepositoryDeployConfig | null>(null);
  const [deployTargetRepositoryId, setDeployTargetRepositoryId] = useState<string | null>(null);
  const [lastPublishedRepositories, setLastPublishedRepositories] = useState<PublishRepositorySummary[]>([]);
  const [deployDraft, setDeployDraft] = useState<DeployDraft>({
    repositoryId: '',
    repositoryName: '',
    env: '',
    branch: '',
    commit: '',
    version: '',
    versionImage: '',
    image: '',
  });
  const toast = useToast();
  const lastWorkflowSnapshotRef = useRef<string>('');
  const hasInitializedStageSelectionRef = useRef(false);
  const syncedReviewReportIdRef = useRef<string | null>(null);
  const busyStageRef = useRef<string | null>(null);

  async function refresh(options?: { silent?: boolean }) {
    if (!workflowRunId) {
      return null;
    }

    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const nextWorkflowRun = await api.getWorkflowRun(workflowRunId);
      const nextSnapshot = buildWorkflowSnapshot(nextWorkflowRun);

      if (nextSnapshot !== lastWorkflowSnapshotRef.current) {
        lastWorkflowSnapshotRef.current = nextSnapshot;
        setWorkflowRun(nextWorkflowRun);
      }

      return nextWorkflowRun;
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : '加载工作流失败');
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, [workflowRunId]);

  useEffect(() => {
    hasInitializedStageSelectionRef.current = false;
    syncedReviewReportIdRef.current = null;
  }, [workflowRunId]);

  useEffect(() => {
    if (!workflowRun) {
      return;
    }

    const suggestedStage = inferFocusedStage(workflowRun);
    if (!hasInitializedStageSelectionRef.current) {
      setSelectedStage(suggestedStage);
      hasInitializedStageSelectionRef.current = true;
      return;
    }

    const currentStage = getStage(workflowRun, selectedStage);

    if (!currentStage || currentStage.status === 'NOT_STARTED' || currentStage.status === undefined) {
      setSelectedStage(suggestedStage);
    }
  }, [workflowRun]);

  useEffect(() => {
    setFeedbackText('');
    setSubmittingAction(null);
  }, [selectedStage, workflowRun?.id]);

  const hasRunningStage = workflowRun?.stageExecutions.some((item) => item.status === 'RUNNING') ?? false;
  const stageActionsLocked = busyStage !== null || hasRunningStage;
  const latestExecutionStage = workflowRun ? getStage(workflowRun, 'EXECUTION') : undefined;
  const latestReviewStage = workflowRun ? getStage(workflowRun, 'AI_REVIEW') : undefined;
  const hasStaleReviewResults =
    !!workflowRun?.reviewReport &&
    !!latestExecutionStage?.attempt &&
    ((latestReviewStage?.attempt ?? 0) < latestExecutionStage.attempt ||
      workflowRun.status === 'REVIEW_PENDING');

  useEffect(() => {
    const reviewReportId = workflowRun?.reviewReport?.id;

    if (!workflowRun || !reviewReportId || selectedStage !== 'AI_REVIEW' || workflowRun.status !== 'HUMAN_REVIEW_PENDING') {
      return;
    }

    if (workflowRun.reviewFindings.length > 0) {
      syncedReviewReportIdRef.current = reviewReportId;
      return;
    }

    if (syncedReviewReportIdRef.current === reviewReportId || hasRunningStage) {
      return;
    }

    syncedReviewReportIdRef.current = reviewReportId;
    setBusyFindingId(`sync:${reviewReportId}`);

    void api
      .syncReviewFindings(reviewReportId)
      .then(async () => {
        await refresh({ silent: true });
      })
      .catch((error) => {
        syncedReviewReportIdRef.current = null;
        toast.error(error instanceof Error ? error.message : '整理 AI 审查结果失败');
      })
      .finally(() => {
        setBusyFindingId(null);
      });
  }, [workflowRun, selectedStage, hasRunningStage]);
  const diffArtifacts = useMemo<DiffArtifactView[]>(
    () => ((workflowRun?.codeExecution?.diffArtifacts as DiffArtifactView[] | undefined) ?? []).filter(Boolean),
    [workflowRun],
  );
  const diffReviewData = useMemo(() => {
    return diffArtifacts.map((artifact, artifactIndex) => {
      const modifiedFiles = splitDiffTextIntoFiles(artifact.diffText);
      const untrackedFiles = (artifact.untrackedFiles ?? []).map((path, untrackedIndex) => ({
        key: `untracked-${path}-${untrackedIndex}`,
        path,
        kind: 'untracked' as const,
        diffText: `未跟踪文件\n\n${path}\n\n该文件尚未纳入 Git 版本控制，请在人工审查时确认是否需要保留。`,
      }));

      return {
        artifactKey: `${artifact.repository}-${artifact.branch}-${artifactIndex}`,
        ...artifact,
        files: [...modifiedFiles, ...untrackedFiles],
      };
    });
  }, [diffArtifacts]);
  const activeArtifact = useMemo(() => {
    return (
      diffReviewData.find((artifact) => artifact.artifactKey === selectedArtifactKey) ??
      diffReviewData[0] ??
      null
    );
  }, [diffReviewData, selectedArtifactKey]);
  const activeDiffFile = useMemo(() => {
    if (!activeArtifact) {
      return null;
    }

    return activeArtifact.files.find((item) => item.key === selectedDiffFileKey) ?? activeArtifact.files[0] ?? null;
  }, [activeArtifact, selectedDiffFileKey]);
  const workflowMetrics = useMemo(() => {
    if (!workflowRun) {
      return null;
    }

    const latestStages = STAGE_SEQUENCE.map((stageKey) => getStage(workflowRun, stageKey)).filter(Boolean);
    const completedStages = latestStages.filter((item) => item?.status === 'COMPLETED').length;
    const waitingStages = latestStages.filter((item) => item?.status === 'WAITING_CONFIRMATION').length;
    const findingsCount = workflowRun.reviewFindings.length;

    return {
      completedStages,
      waitingStages,
      findingsCount,
      repositoryCount: workflowRun.workflowRepositories.length,
    };
  }, [workflowRun]);
  const branchSummaryText = useMemo(() => {
    if (!workflowRun?.workflowRepositories.length) {
      return '';
    }

    const first = workflowRun.workflowRepositories[0];
    if (workflowRun.workflowRepositories.length === 1) {
      return `工作分支：${first.name} / ${first.workingBranch}`;
    }

    return `工作分支：${first.name} / ${first.workingBranch} 等 ${workflowRun.workflowRepositories.length} 个`;
  }, [workflowRun]);

  useEffect(() => {
    if (!hasRunningStage) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [hasRunningStage, workflowRunId]);

  useEffect(() => {
    if (!activeArtifact) {
      setSelectedArtifactKey(null);
      setSelectedDiffFileKey(null);
      return;
    }

    if (selectedArtifactKey !== activeArtifact.artifactKey) {
      setSelectedArtifactKey(activeArtifact.artifactKey);
    }

    if (!activeDiffFile && activeArtifact.files[0]) {
      setSelectedDiffFileKey(activeArtifact.files[0].key);
      return;
    }

    if (activeDiffFile && selectedDiffFileKey !== activeDiffFile.key) {
      setSelectedDiffFileKey(activeDiffFile.key);
    }
  }, [activeArtifact, activeDiffFile, selectedArtifactKey, selectedDiffFileKey]);

  async function runAction(
    stage: string,
    action: () => Promise<unknown>,
    successText: string,
    options?: { focusNextStage?: boolean },
  ) {
    if (busyStageRef.current || hasRunningStage) {
      return;
    }

    busyStageRef.current = stage;
    setBusyStage(stage);
    try {
      await action();
      const nextWorkflowRun = await refresh();
      if (options?.focusNextStage && nextWorkflowRun) {
        setSelectedStage(inferFocusedStage(nextWorkflowRun));
      }
      toast.success(successText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      busyStageRef.current = null;
      setBusyStage(null);
    }
  }

  function getEditableStageForSelectedStage(stageKey: WorkflowStageKey): EditableStage | null {
    if (stageKey === 'TASK_SPLIT') {
      return 'task-split';
    }
    if (stageKey === 'TECHNICAL_PLAN') {
      return 'plan';
    }
    if (stageKey === 'EXECUTION') {
      return 'execution';
    }
    if (stageKey === 'AI_REVIEW') {
      return 'review';
    }
    return null;
  }

  async function submitFeedback() {
    if (!workflowRun) {
      return;
    }

    const editableStage = getEditableStageForSelectedStage(selectedStage);
    if (!editableStage) {
      return;
    }

    const nextFeedback = feedbackText.trim();
    if (!nextFeedback) {
      toast.error('请输入你希望 AI 调整的意见');
      return;
    }

    setSubmittingAction('feedback');
    try {
      if (editableStage === 'task-split') {
        await api.reviseTaskSplit(workflowRun.id, nextFeedback);
      } else if (editableStage === 'plan') {
        await api.revisePlan(workflowRun.id, nextFeedback);
      } else if (editableStage === 'execution') {
        await api.reviseExecution(workflowRun.id, nextFeedback);
      } else {
        await api.reviseReview(workflowRun.id, nextFeedback);
      }

      setFeedbackText('');
      await refresh();
      toast.success('AI 已根据意见重新处理当前阶段');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交意见失败');
    } finally {
      setSubmittingAction(null);
    }
  }

  async function runFindingAction(findingId: string, action: () => Promise<unknown>, successText: string) {
    if (busyFindingId) {
      return;
    }

    setBusyFindingId(findingId);
    try {
      await action();
      await refresh({ silent: true });
      toast.success(successText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '处理审查条目失败');
    } finally {
      setBusyFindingId(null);
    }
  }

  async function handleDeleteWorkflow() {
    if (!workflowRun) {
      return;
    }

    const confirmed = window.confirm('删除后将清空这条工作流的阶段记录、审查结果和工作副本。确认删除吗？');
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    try {
      await api.deleteWorkflowRun(workflowRun.id);
      toast.success('工作流已删除');
      navigate('/workflow-runs', { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除工作流失败');
    } finally {
      setDeleting(false);
    }
  }

  async function handlePublishGitChanges() {
    if (!workflowRun) {
      return;
    }

    setPublishing(true);
    try {
      const result = await api.publishWorkflowGitChanges(workflowRun.id);
      setLastPublishedRepositories(result.repositories);
      await refresh({ silent: true });
      const branchSummary = result.repositories
        .map((item) => `${item.repository}: ${item.branch} @ ${item.remoteUrl}`)
        .join('；');
      toast.success(
        `已推送并校验 ${result.repositories.length} 个代码库。${branchSummary}。提交信息：${result.message}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交远程失败');
    } finally {
      setPublishing(false);
    }
  }

  async function handleOpenDeployModal(repositoryId?: string) {
    if (!workflowRun) {
      return;
    }

    setDeployLoading(true);
    try {
      const matchedRepository =
        workflowRun.workflowRepositories.find((repository) => repository.repositoryId === repositoryId) ??
        workflowRun.workflowRepositories[0] ??
        null;

      if (!matchedRepository) {
        toast.error('当前工作流没有可部署的仓库');
        return;
      }

      if (!matchedRepository.repositoryId) {
        toast.error('当前工作流仓库没有关联到工作区仓库记录，暂时无法触发部署。');
        return;
      }

      const config = await api.getRepositoryDeployConfig(matchedRepository.repositoryId);
      setDeployConfig(config);
      setDeployTargetRepositoryId(matchedRepository.repositoryId);

      if (!config.enabled) {
        toast.error('当前仓库还没有启用部署配置，请先在工作区的仓库管理里维护部署模板。');
        return;
      }

      const primaryRepository =
        lastPublishedRepositories.find((item) => item.repository === matchedRepository.name) ??
        null;
      const configJson =
        config.configJson && typeof config.configJson === 'object'
          ? config.configJson
          : {};

      setDeployDraft({
        repositoryId: matchedRepository.repositoryId,
        repositoryName: matchedRepository.name,
        env: typeof configJson.env === 'string' ? configJson.env : '',
        branch: primaryRepository?.branch ?? matchedRepository.workingBranch ?? '',
        commit: primaryRepository?.commitSha ?? '',
        version: '',
        versionImage: '',
        image: typeof configJson.image === 'string' ? configJson.image : '',
      });
      setDeployModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取部署配置失败');
    } finally {
      setDeployLoading(false);
    }
  }

  async function handleCreateDeployJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workflowRun) {
      return;
    }

    if (!deployTargetRepositoryId) {
      toast.error('缺少目标仓库，无法触发部署');
      return;
    }

    if (!deployDraft.branch.trim()) {
      toast.error('请填写要发布的分支');
      return;
    }

    setDeploySubmitting(true);
    try {
      const result = await api.createRepositoryDeployJob(deployTargetRepositoryId, {
        workflowRunId: workflowRun.id,
        projectId: workflowRun.requirement.project.id,
        env: deployDraft.env.trim() || undefined,
        branch: deployDraft.branch.trim(),
        commit: deployDraft.commit.trim() || undefined,
        version: deployDraft.version.trim() || undefined,
        versionImage: deployDraft.versionImage.trim() || undefined,
        image: deployDraft.image.trim() || undefined,
      });
      setDeployModalOpen(false);
      toast.success(`${result.message} 记录号：${result.job.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '触发部署失败');
    } finally {
      setDeploySubmitting(false);
    }
  }

  const stageContent = useMemo<Record<WorkflowStageKey, StageDetailView> | null>(() => {
    if (!workflowRun) {
      return null;
    }

    const groundingStage = getStage(workflowRun, 'REPOSITORY_GROUNDING');
    const taskSplitStage = getStage(workflowRun, 'TASK_SPLIT');
    const planStage = getStage(workflowRun, 'TECHNICAL_PLAN');
    const executionStage = getStage(workflowRun, 'EXECUTION');
    const reviewStage = getStage(workflowRun, 'AI_REVIEW');
    const repositoryPaths = workflowRun.workflowRepositories.map((repository) => ({
      name: repository.name,
      localPath: repository.localPath,
    }));

    return {
      REPOSITORY_GROUNDING: {
        title: stageMeta.REPOSITORY_GROUNDING.stageNo,
        subtitle: stageMeta.REPOSITORY_GROUNDING.title,
        status: groundingStage?.status,
        statusMessage: groundingStage?.statusMessage,
        attempt: groundingStage?.attempt,
        output: sanitizeDisplayValue(groundingStage?.output, repositoryPaths),
        actions: [],
      },
      TASK_SPLIT: {
        title: stageMeta.TASK_SPLIT.stageNo,
        subtitle: stageMeta.TASK_SPLIT.title,
        status: taskSplitStage?.status,
        statusMessage: taskSplitStage?.statusMessage,
        attempt: taskSplitStage?.attempt,
        output: sanitizeDisplayValue(taskSplitStage?.output ?? { tasks: workflowRun.tasks }, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: '执行任务拆解',
            onClick: () => void runAction('TASK_SPLIT', () => api.runTaskSplit(workflowRun.id), '任务拆解已启动'),
            disabled: workflowRun.status !== 'TASK_SPLIT_PENDING' || stageActionsLocked,
            loading: busyStage === 'TASK_SPLIT',
            variant: 'primary' as const,
          },
          {
            key: 'confirm',
            label: '确认',
            onClick: () =>
              void runAction('TASK_SPLIT', () => api.confirmTaskSplit(workflowRun.id), '任务拆解已确认', {
                focusNextStage: true,
              }),
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'TASK_SPLIT',
          },
          {
            key: 'reject',
            label: '驳回',
            onClick: () => void runAction('TASK_SPLIT', () => api.rejectTaskSplit(workflowRun.id), '任务拆解已驳回'),
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'TASK_SPLIT',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('task-split'),
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || stageActionsLocked,
          },
        ],
      },
      TECHNICAL_PLAN: {
        title: stageMeta.TECHNICAL_PLAN.stageNo,
        subtitle: stageMeta.TECHNICAL_PLAN.title,
        status: planStage?.status,
        statusMessage: planStage?.statusMessage,
        attempt: planStage?.attempt,
        output: sanitizeDisplayValue(planStage?.output ?? workflowRun.plan, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: '生成技术方案',
            onClick: () => void runAction('TECHNICAL_PLAN', () => api.runPlan(workflowRun.id), '技术方案生成已启动'),
            disabled: workflowRun.status !== 'PLAN_PENDING' || stageActionsLocked,
            loading: busyStage === 'TECHNICAL_PLAN',
            variant: 'primary' as const,
          },
          {
            key: 'confirm',
            label: '确认',
            onClick: () =>
              void runAction('TECHNICAL_PLAN', () => api.confirmPlan(workflowRun.id), '技术方案已确认', {
                focusNextStage: true,
              }),
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'TECHNICAL_PLAN',
          },
          {
            key: 'reject',
            label: '驳回',
            onClick: () => void runAction('TECHNICAL_PLAN', () => api.rejectPlan(workflowRun.id), '技术方案已驳回'),
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
            loading: busyStage === 'TECHNICAL_PLAN',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('plan'),
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || stageActionsLocked,
          },
        ],
      },
      EXECUTION: {
        title: stageMeta.EXECUTION.stageNo,
        subtitle: stageMeta.EXECUTION.title,
        status: executionStage?.status,
        statusMessage: executionStage?.statusMessage,
        attempt: executionStage?.attempt,
        output: sanitizeDisplayValue(workflowRun.codeExecution, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: '执行开发',
            onClick: () => void runAction('EXECUTION', () => api.runExecution(workflowRun.id), '开发执行已启动'),
            disabled: workflowRun.status !== 'EXECUTION_PENDING' || stageActionsLocked,
            loading: busyStage === 'EXECUTION',
            variant: 'primary' as const,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled:
              (workflowRun.status !== 'REVIEW_PENDING' && workflowRun.status !== 'DONE') ||
              stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('execution'),
            disabled:
              !workflowRun.codeExecution ||
              !['REVIEW_PENDING', 'HUMAN_REVIEW_PENDING', 'DONE'].includes(workflowRun.status) ||
              stageActionsLocked,
          },
        ],
      },
      AI_REVIEW: {
        title: stageMeta.AI_REVIEW.stageNo,
        subtitle: stageMeta.AI_REVIEW.title,
        status: reviewStage?.status,
        statusMessage: reviewStage?.statusMessage,
        attempt: reviewStage?.attempt,
        output: sanitizeDisplayValue(workflowRun.reviewReport, repositoryPaths),
        actions: [
          {
            key: 'run',
            label: workflowRun.reviewReport ? '重新执行 AI 审查' : '执行 AI 审查',
            onClick: () => void runAction('AI_REVIEW', () => api.runReview(workflowRun.id), 'AI 审查已启动'),
            disabled:
              !['REVIEW_PENDING', 'HUMAN_REVIEW_PENDING', 'DONE'].includes(workflowRun.status) ||
              stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
            variant: 'primary' as const,
          },
          {
            key: 'accept',
            label: '通过',
            onClick: () =>
              void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'accept'), '工作流已通过', {
                focusNextStage: true,
              }),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
          },
          {
            key: 'rework',
            label: '返工',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'rework'), '工作流已退回开发执行'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
          },
          {
            key: 'rollback',
            label: '回滚',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'rollback'), '工作流已回滚'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || stageActionsLocked,
            loading: busyStage === 'AI_REVIEW',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => setWorkspaceMode('feedback'),
            disabled:
              (workflowRun.status !== 'HUMAN_REVIEW_PENDING' && workflowRun.status !== 'DONE') ||
              stageActionsLocked,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => openWorkspaceEditMode('review'),
            disabled:
              (workflowRun.status !== 'HUMAN_REVIEW_PENDING' && workflowRun.status !== 'DONE') ||
              stageActionsLocked,
          },
        ],
      },
    };
  }, [workflowRun, busyStage, stageActionsLocked]);

  if (!workflowRunId) {
    return <Navigate to="/workflow-runs" replace />;
  }

  const selectedStageContent = stageContent?.[selectedStage];
  const selectedStageIndex = STAGE_SEQUENCE.indexOf(selectedStage);
  const reviewReportId = workflowRun?.reviewReport?.id ?? null;
  const workflowWorkspaceConfig = useMemo<WorkflowWorkspaceConfig | null>(() => {
    if (!selectedStageContent) {
      return null;
    }

    const editableStage = getEditableStageForSelectedStage(selectedStage);
    if (!editableStage) {
      return null;
    }

    const actionsByKey = new Map(selectedStageContent.actions.map((action) => [action.key, action]));
    const runActionView = actionsByKey.get('run');
    const confirmAction = actionsByKey.get('confirm');
    const rejectAction = actionsByKey.get('reject');
    const acceptAction = actionsByKey.get('accept');

    const canSendFeedback = Boolean(actionsByKey.get('feedback')) && selectedStageContent.actions.some((action) => action.key === 'feedback' && !action.disabled);

    const primaryAction: WorkflowWorkspaceAction = canSendFeedback
      ? {
          key: 'send-feedback',
          label: '发送修改意见',
          onClick: () => void submitFeedback(),
          disabled: !feedbackText.trim() || submittingAction !== null || stageActionsLocked,
          loading: submittingAction === 'feedback',
          variant: 'primary',
        }
      : {
          key: runActionView?.key ?? 'noop',
          label: runActionView?.label ?? '当前阶段暂无可执行操作',
          onClick: runActionView?.onClick ?? (() => undefined),
          disabled: runActionView?.disabled ?? true,
          loading: runActionView?.loading,
          variant: 'primary',
        };

    const secondaryActions: WorkflowWorkspaceAction[] = [];

    [confirmAction, rejectAction, acceptAction]
      .filter((action): action is StageActionView => Boolean(action))
      .forEach((action) => {
        secondaryActions.push({
          key: action.key,
          label: action.label,
          onClick: action.onClick,
          disabled: action.disabled,
          loading: action.loading,
          danger: action.danger,
          variant: action.variant,
        });
      });

    return {
      stage: editableStage,
      title: selectedStageContent.subtitle,
      helperText: '边看左侧产物边写意见，不离开当前工作流上下文。',
      statusLabel: selectedStageContent.status ? formatStageExecutionStatus(selectedStageContent.status) : '未开始',
      feedbackPlaceholder: '描述你希望 AI 如何调整当前阶段的产出，例如补充遗漏任务、调整技术路线、补测试或修正审查重点。',
      primaryAction,
      secondaryActions,
    };
  }, [
    selectedStageContent,
    selectedStage,
    feedbackText,
    submittingAction,
    stageActionsLocked,
  ]);

  return (
    <>
      <Dialog
        open={deployModalOpen}
        onOpenChange={(open) => {
          setDeployModalOpen(open);
          if (!open) {
            setDeploySubmitting(false);
            setDeployTargetRepositoryId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>触发部署</DialogTitle>
            <DialogDescription>
              这一步会调用仓库绑定的 CI/CD provider。建议先完成“提交并推送到远程”，再基于已推送分支触发 OPS。
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreateDeployJob(event)}>
            <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
              目标仓库：{deployDraft.repositoryName || '未选择'}
            </div>
            {lastPublishedRepositories.length > 1 ? (
              <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">
                当前工作流刚刚推送了 {lastPublishedRepositories.length} 个仓库。当前部署接口只会提交一组发布参数，请确认这里填写的是目标仓库对应的分支和 commit。
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="deploy-env">环境</label>
                <UiInput
                  id="deploy-env"
                  value={deployDraft.env}
                  onChange={(event) => setDeployDraft((current) => ({ ...current, env: event.target.value }))}
                  placeholder="例如 dev"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="deploy-branch">分支</label>
                <UiInput
                  id="deploy-branch"
                  value={deployDraft.branch}
                  onChange={(event) => setDeployDraft((current) => ({ ...current, branch: event.target.value }))}
                  placeholder="例如 feature_2.1.7"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="deploy-commit">Commit</label>
                <UiInput
                  id="deploy-commit"
                  value={deployDraft.commit}
                  onChange={(event) => setDeployDraft((current) => ({ ...current, commit: event.target.value }))}
                  placeholder="可选，优先带上已推送 commit"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="deploy-version">版本号</label>
                <UiInput
                  id="deploy-version"
                  value={deployDraft.version}
                  onChange={(event) => setDeployDraft((current) => ({ ...current, version: event.target.value }))}
                  placeholder="例如 2.1.7"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="deploy-version-image">镜像版本</label>
                <UiInput
                  id="deploy-version-image"
                  value={deployDraft.versionImage}
                  onChange={(event) => setDeployDraft((current) => ({ ...current, versionImage: event.target.value }))}
                  placeholder="例如 2.1.7-build.3"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-foreground" htmlFor="deploy-image">镜像地址</label>
                <UiInput
                  id="deploy-image"
                  value={deployDraft.image}
                  onChange={(event) => setDeployDraft((current) => ({ ...current, image: event.target.value }))}
                  placeholder="例如 registry/app:tag"
                />
              </div>
            </div>
            {deployConfig ? (
              <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                当前 provider：{deployConfig.provider}。未填写的字段会继续使用该仓库的默认部署模板。
              </div>
            ) : null}
            <UiButton type="submit" disabled={deploySubmitting}>
              {deploySubmitting ? '触发中...' : '确认触发部署'}
            </UiButton>
          </form>
        </DialogContent>
      </Dialog>
      {workflowRun ? (
        <div className="flex flex-col gap-5">
          <DetailHeader
            eyebrow="Workflow Detail"
            title={workflowRun.requirement.title}
            badges={[
              { key: 'workspace', label: workflowRun.requirement.project.workspace.name, variant: 'default' },
              { key: 'project', label: workflowRun.requirement.project.name, variant: 'outline' },
              {
                key: 'provider',
                label: workflowRun.aiProvider === 'cursor' ? 'Cursor CLI' : 'Codex',
                variant: 'outline',
              },
              { key: 'id', label: workflowRun.id, variant: 'outline' },
              { key: 'status', label: formatWorkflowStatus(workflowRun.status), variant: 'secondary' },
            ]}
            actions={
              <>
                <UiButton variant="destructive" disabled={deleting || hasRunningStage} onClick={() => void handleDeleteWorkflow()}>
                  {deleting ? '删除中...' : '删除工作流'}
                </UiButton>
                <UiButton variant="outline" asChild>
                  <Link to="/workflow-runs">返回列表</Link>
                </UiButton>
              </>
            }
          />

          {workflowRun.workflowRepositories.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/35 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm leading-6 text-muted-foreground">{branchSummaryText}</p>
                <UiButton
                  size="sm"
                  variant="ghost"
                  onClick={() => setBranchSummaryExpanded((current) => !current)}
                >
                  {branchSummaryExpanded ? '收起分支' : '查看分支'}
                </UiButton>
              </div>
              {branchSummaryExpanded ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {workflowRun.workflowRepositories.map((repository) => (
                    <div key={repository.id} className="text-sm leading-6 text-muted-foreground">
                      <span className="font-medium text-foreground">{repository.name}</span>
                      {' / '}
                      <span>{repository.workingBranch}</span>
                      {' / '}
                      <span>基线 {repository.baseBranch}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {workflowMetrics ? (
            <div className="grid gap-5 md:grid-cols-4">
              <MetricCard
                label="当前状态"
                value={formatWorkflowStatus(workflowRun.status)}
                helpText={hasRunningStage ? '当前有阶段正在后台执行。' : '当前没有后台执行中的阶段。'}
              />
              <MetricCard
                label="阶段进度"
                value={`${workflowMetrics.completedStages}/${STAGE_SEQUENCE.length}`}
                helpText="已完成阶段数，按任务拆解到 AI 审查统计。"
              />
              <MetricCard
                label="待人工处理"
                value={workflowMetrics.waitingStages}
                helpText="等待人工确认或下一步决策的阶段数量。"
              />
              <MetricCard
                label="代码上下文"
                value={workflowMetrics.repositoryCount}
                helpText={
                  workflowMetrics.findingsCount > 0
                    ? `已沉淀 ${workflowMetrics.findingsCount} 条审查条目。`
                    : '当前还没有沉淀的审查条目。'
                }
              />
            </div>
          ) : null}

          <ContextPanel
            eyebrow="Workflow Context"
            title="需求与验收信息"
            description="集中查看本次工作流对应的需求背景与完成标准。"
          >
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">需求描述</div>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">
                  {workflowRun.requirement.description?.trim() || '当前需求尚未填写描述。'}
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">验收标准</div>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">
                  {workflowRun.requirement.acceptanceCriteria?.trim() || '当前需求尚未填写验收标准。'}
                </p>
              </div>
            </div>
          </ContextPanel>

          <Card className="rounded-md border-border bg-card shadow-sm">
            <CardHeader className="p-5 pb-0">
              <SectionHeader
                eyebrow="Workflow Steps"
                title="按阶段查看流程与产物"
                className="flex flex-wrap items-start justify-between gap-3"
                extra={<span className="text-sm leading-6 text-muted-foreground">点击步骤切换详情，产物仅在下方显示</span>}
              />
            </CardHeader>
            <CardContent className="p-5 pt-4">
              <WorkflowSteps
                current={selectedStageIndex}
                className="workflow-steps"
                onChange={(next) => setSelectedStage(STAGE_SEQUENCE[next] ?? 'TASK_SPLIT')}
                items={STAGE_SEQUENCE.map((stageKey) => {
                  const stage = getStage(workflowRun, stageKey);
                  return {
                    key: stageKey,
                    title: stageMeta[stageKey].stepLabel,
                    description: getStepDescription(stage),
                    status: getStepVisualStatus(stage?.status),
                  };
                })}
              />
            </CardContent>
          </Card>

          <div className="grid items-start gap-5 min-[1281px]:grid-cols-[minmax(0,1.5fr)_360px] max-[1280px]:grid-cols-1">
            {/* Left: main content */}
            <div className="flex flex-col gap-5">
              {selectedStageContent ? (
                <StageCard
                  title={selectedStageContent.title}
                  subtitle={selectedStageContent.subtitle}
                  status={selectedStageContent.status}
                  statusMessage={selectedStageContent.statusMessage}
                  attempt={selectedStageContent.attempt}
                  metaItems={[
                    { key: 'step', label: '当前步骤', value: `${selectedStageIndex + 1}/${STAGE_SEQUENCE.length}` },
                    {
                      key: 'focus-status',
                      label: '阶段状态',
                      value: (
                        <Badge
                          variant={
                            selectedStageContent.status === 'COMPLETED'
                              ? 'success'
                              : selectedStageContent.status === 'FAILED' || selectedStageContent.status === 'REJECTED'
                                ? 'destructive'
                                : selectedStageContent.status === 'WAITING_CONFIRMATION' || selectedStageContent.status === 'RUNNING'
                                  ? 'warning'
                                  : 'default'
                          }
                        >
                          {selectedStageContent.status ? formatStageExecutionStatus(selectedStageContent.status) : '未开始'}
                        </Badge>
                      ),
                    },
                  ]}
                  output={selectedStageContent.output}
                  actions={[]}
                />
              ) : (
                <Card className="rounded-md border border-border bg-card shadow-sm">
                  <CardContent className="p-5">
                    <EmptyState description="当前阶段还没有可展示的详情产物。" />
                  </CardContent>
                </Card>
              )}

              {diffReviewData.length > 0 && (selectedStage === 'EXECUTION' || selectedStage === 'AI_REVIEW') ? (
              <Card className="rounded-md border-border bg-card shadow-sm">
                <CardHeader className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4 max-[1180px]:flex-col">
                    <SectionHeader
                      eyebrow="Diff Review"
                      title="代码变更审查"
                      description="先确认变更范围，再逐文件查看真实差异，最后结合 AI 审查结果做人工判断。"
                    />
                    <div className="grid min-w-[340px] grid-cols-3 gap-[10px] max-[1180px]:min-w-0 max-[1180px]:grid-cols-2 max-[780px]:grid-cols-1">
                      <StatPill label="变更仓库" value={diffReviewData.length} />
                      <StatPill
                        label="变更文件"
                        value={diffReviewData.reduce((total, artifact) => total + artifact.files.length, 0)}
                      />
                      <StatPill
                        label="未跟踪文件"
                        value={diffReviewData.reduce((total, artifact) => total + artifact.untrackedFiles.length, 0)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  {activeArtifact ? (
                    <Tabs
                      value={activeArtifact.artifactKey}
                      onValueChange={(value) => {
                        const nextArtifact = diffReviewData.find((item) => item.artifactKey === value);
                        setSelectedArtifactKey(value);
                        setSelectedDiffFileKey(nextArtifact?.files[0]?.key ?? null);
                      }}
                    >
                      <TabsList>
                        {diffReviewData.map((artifact) => (
                          <TabsTrigger
                            key={artifact.artifactKey}
                            value={artifact.artifactKey}
                            className="flex min-w-[180px] flex-col items-start justify-start gap-1"
                          >
                            <span className="text-sm font-semibold">{artifact.repository}</span>
                            <span className="text-xs text-muted-foreground">{artifact.branch}</span>
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      {diffReviewData.map((artifact) => {
                        const artifactFiles = artifact.files;
                        const currentFile =
                          artifact.artifactKey === activeArtifact.artifactKey
                            ? activeDiffFile
                            : artifact.files.find((item) => item.key === selectedDiffFileKey) ?? artifact.files[0] ?? null;

                        return (
                          <TabsContent key={artifact.artifactKey} value={artifact.artifactKey}>
                            <div className="grid items-start gap-4 [grid-template-columns:320px_minmax(0,1fr)] max-[1440px]:[grid-template-columns:280px_minmax(0,1fr)] max-[1180px]:grid-cols-1">
                              <DiffFileListPanel
                                count={artifactFiles.length}
                                files={artifactFiles}
                                activeKey={currentFile?.key}
                                onSelect={(key) => {
                                  if (artifact.artifactKey !== activeArtifact.artifactKey) {
                                    setSelectedArtifactKey(artifact.artifactKey);
                                  }
                                  setSelectedDiffFileKey(key);
                                }}
                              />

                              <DiffViewerPanel
                                filePath={currentFile?.path}
                                repository={artifact.repository}
                                branch={artifact.branch}
                                diffText={currentFile?.diffText}
                              />
                            </div>
                          </TabsContent>
                        );
                      })}
                    </Tabs>
                  ) : (
                    <EmptyState description="当前执行结果还没有可审查的 diff。" />
                  )}
                </CardContent>
              </Card>
            ) : null}

            {selectedStage === 'AI_REVIEW' ? (
              <Card className="rounded-md border-border bg-card shadow-sm">
                <CardHeader className="p-5">
                  <div className="mb-4 flex items-start justify-between gap-4 max-[960px]:flex-col">
                    <SectionHeader
                      eyebrow="AI Review Results"
                      title="AI 审查结果"
                      description="直接基于审查结果决定继续修复、转为问题项或转为缺陷，不再额外理解中间对象。"
                    />
                    <div className="flex flex-col items-end gap-3 max-[960px]:items-start">
                      <div className="flex flex-wrap justify-end gap-2 max-[960px]:justify-start">
                        <Badge variant="secondary">{workflowRun.reviewFindings.length} 条结果</Badge>
                        <Badge variant="default">{workflowRun.reviewFindings.filter((item) => !item.convertedIssueId && !item.convertedBugId).length} 条待处理</Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  {hasStaleReviewResults ? (
                    <div className="mb-4 flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">
                      <div>
                        当前展示的是上一轮 AI 审查结果。你可以继续逐条修复，也可以在任何时候重新执行 AI 审查来刷新结果。
                      </div>
                      <div>
                        <UiButton
                          onClick={() => void runAction('AI_REVIEW', () => api.runReview(workflowRun.id), 'AI 审查已启动')}
                          disabled={stageActionsLocked}
                        >
                          {busyStage === 'AI_REVIEW' ? '处理中...' : '重新执行 AI 审查'}
                        </UiButton>
                      </div>
                    </div>
                  ) : null}
                  {workflowRun.reviewFindings.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {workflowRun.reviewFindings.map((finding) => (
                        <ReviewFindingCard
                          key={finding.id}
                          id={finding.id}
                          title={finding.title}
                          type={finding.type}
                          severity={finding.severity}
                          status={finding.status}
                          description={finding.description}
                          impactScope={finding.impactScope}
                          actions={[
                            {
                              key: 'fix',
                              label: busyFindingId === finding.id ? '处理中...' : '立即修复',
                              variant: 'outline',
                              onClick: () =>
                                void runFindingAction(
                                  finding.id,
                                  () => api.fixReviewFinding(workflowRun.id, finding.id),
                                  '已开始基于该审查结果继续修复，请检查代码变更后再执行 AI 审查',
                                ),
                              disabled:
                                busyFindingId !== null ||
                                finding.status === 'FIXED_PENDING_REVIEW' ||
                                (workflowRun.status !== 'HUMAN_REVIEW_PENDING' &&
                                  workflowRun.status !== 'DONE'),
                            },
                            {
                              key: 'issue',
                              label: busyFindingId === finding.id ? '处理中...' : '转问题项',
                              variant: 'outline',
                              onClick: () =>
                                void runFindingAction(finding.id, () => api.convertReviewFindingToIssue(finding.id), '已录入为问题项'),
                              disabled:
                                busyFindingId !== null ||
                                (workflowRun.status !== 'HUMAN_REVIEW_PENDING' &&
                                  workflowRun.status !== 'DONE') ||
                                !!finding.convertedIssueId ||
                                !!finding.convertedBugId,
                            },
                            {
                              key: 'bug',
                              label: busyFindingId === finding.id ? '处理中...' : '转缺陷',
                              onClick: () =>
                                void runFindingAction(finding.id, () => api.convertReviewFindingToBug(finding.id), '已录入为缺陷'),
                              disabled:
                                busyFindingId !== null ||
                                (workflowRun.status !== 'HUMAN_REVIEW_PENDING' &&
                                  workflowRun.status !== 'DONE') ||
                                !!finding.convertedIssueId ||
                                !!finding.convertedBugId,
                            },
                          ]}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      description={
                        reviewReportId && busyFindingId === `sync:${reviewReportId}`
                          ? '正在整理 AI 审查结果...'
                          : '当前还没有可操作的 AI 审查结果。'
                      }
                    />
                  )}
                </CardContent>
              </Card>
            ) : null}

            {workflowRun.status === 'DONE' ? (
              <Card className="rounded-md border-border bg-card shadow-sm">
                <CardHeader className="p-5">
                  <SectionHeader
                    eyebrow="Git Publish"
                    title="提交到远程"
                    description="人工确认通过后，会基于当前工作分支生成唯一的发布分支，并将代码推送到远程仓库。"
                  />
                </CardHeader>
                <CardContent className="flex flex-col gap-4 p-5 pt-0">
                  <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                    这个动作会自动完成 git add、git commit 和 git push。推送时不会直接复用工作分支，而是生成唯一的发布分支，避免与远端已有分支冲突。
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <UiButton onClick={() => void handlePublishGitChanges()} disabled={publishing || deployLoading}>
                      {publishing ? '处理中...' : '提交并推送到远程'}
                    </UiButton>
                    <UiButton variant="outline" onClick={() => void handleOpenDeployModal()} disabled={publishing || deployLoading}>
                      {deployLoading ? '读取配置中...' : '按仓库触发部署'}
                    </UiButton>
                  </div>
                  {lastPublishedRepositories.length > 0 ? (
                    <div className="rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm leading-6 text-success">
                      最近一次推送：{lastPublishedRepositories.map((item) => `${item.repository} / ${item.branch} / ${item.commitSha}`).join('；')}
                    </div>
                  ) : (
                    <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                      建议先执行"提交并推送到远程"，这样部署弹窗可以自动带出对应仓库的最新发布分支和 commit。
                    </div>
                  )}
                  <div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      部署模板现在跟着仓库走。你可以先去工作区里的仓库管理维护默认参数，再回到这里基于某个已推送仓库触发发布。
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            </div>

            {/* Right: sidebar */}
            <div
              data-testid="workflow-review-sidebar-shell"
              className="flex flex-col gap-5 self-start min-[1281px]:sticky min-[1281px]:top-6"
            >
              {workflowWorkspaceConfig ? (
                <WorkflowReviewSidebar
                  stageTitle={workflowWorkspaceConfig.title}
                  stageStatusLabel={workflowWorkspaceConfig.statusLabel}
                  helperText={workflowWorkspaceConfig.helperText}
                  feedbackText={feedbackText}
                  feedbackPlaceholder={workflowWorkspaceConfig.feedbackPlaceholder}
                  onFeedbackChange={setFeedbackText}
                  primaryAction={workflowWorkspaceConfig.primaryAction}
                  secondaryActions={workflowWorkspaceConfig.secondaryActions}
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <Card className="rounded-md border border-border bg-card shadow-sm">
          <CardContent className="p-5">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Spinner className="h-7 w-7" />
              </div>
            ) : (
              <EmptyState description="没有找到对应的工作流记录。" />
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
