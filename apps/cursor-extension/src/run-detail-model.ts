import type { WorkflowRunDetail, WorkflowStageExecution } from './flowx-client';

export type StageKey =
  | 'REPOSITORY_GROUNDING'
  | 'BRAINSTORM'
  | 'DESIGN'
  | 'SPEC_PLAN'
  | 'EXECUTION'
  | 'AI_REVIEW'
  | 'HUMAN_REVIEW';

export type StageActionKind =
  | 'run'
  | 'confirm'
  | 'reject'
  | 'revise'
  | 'claim'
  | 'cancel'
  | 'complete'
  | 'decide'
  | 'localGenerate'
  | 'localSubmit';

export interface StageActionDescriptor {
  /** Stable id for the webview button. */
  id: string;
  label: string;
  kind: StageActionKind;
  /** revise needs a feedback string collected from the user. */
  needsFeedback?: boolean;
  /** human-review decide passes a decision value. */
  decision?: string;
  danger?: boolean;
}

export interface StageTimelineItem {
  key: StageKey;
  title: string;
  status: string;
  statusMessage?: string | null;
  attempt?: number;
  isCurrent: boolean;
  actions: StageActionDescriptor[];
}

export interface ExecutionClaimState {
  claimed: boolean;
  executor?: string;
  claimedByUserId?: string | null;
  claimedAt?: string | null;
}

export interface RunDetailModel {
  runId: string;
  status: string;
  title?: string;
  timeline: StageTimelineItem[];
  execution: ExecutionClaimState;
}

const STAGES: Array<{ key: StageKey; title: string }> = [
  { key: 'REPOSITORY_GROUNDING', title: '仓库 Grounding' },
  { key: 'BRAINSTORM', title: '头脑风暴' },
  { key: 'DESIGN', title: '设计方案' },
  { key: 'SPEC_PLAN', title: 'Spec & Plan' },
  { key: 'EXECUTION', title: '执行' },
  { key: 'AI_REVIEW', title: 'AI 审查' },
  { key: 'HUMAN_REVIEW', title: '人工审核' },
];

function currentStageKey(status: string): StageKey | null {
  if (status === 'REPOSITORY_GROUNDING_PENDING') return 'REPOSITORY_GROUNDING';
  if (status === 'BRAINSTORM_PENDING') return 'BRAINSTORM';
  if (status.startsWith('DESIGN_')) return 'DESIGN';
  if (status.startsWith('SPEC_PLAN_')) return 'SPEC_PLAN';
  if (status.startsWith('EXECUTION_')) return 'EXECUTION';
  if (status === 'REVIEW_PENDING') return 'AI_REVIEW';
  if (status === 'HUMAN_REVIEW_PENDING') return 'HUMAN_REVIEW';
  return null;
}

function latestStage(run: WorkflowRunDetail, key: StageKey): WorkflowStageExecution | undefined {
  return run.stageExecutions
    .filter((stage) => stage.stage === key)
    .sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0))[0];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Derive the local/cloud execution claim state from the latest EXECUTION stage input. */
export function deriveExecutionClaim(run: WorkflowRunDetail): ExecutionClaimState {
  const stage = latestStage(run, 'EXECUTION');
  const input = asRecord(stage?.input);
  const executor = typeof input?.executor === 'string' ? (input.executor as string) : undefined;
  const claimed = stage?.status === 'RUNNING' && executor === 'LOCAL';
  return {
    claimed,
    executor,
    claimedByUserId: typeof input?.claimedByUserId === 'string' ? (input.claimedByUserId as string) : null,
    claimedAt: typeof input?.claimedAt === 'string' ? (input.claimedAt as string) : null,
  };
}

function actionsForStage(
  key: StageKey,
  status: string,
  execution: ExecutionClaimState,
): StageActionDescriptor[] {
  switch (key) {
    case 'DESIGN':
      if (status === 'DESIGN_PENDING')
        return [
          { id: 'design.localGenerate', label: '本地生成设计(od mcp)', kind: 'localGenerate' },
          { id: 'design.localSubmit', label: '提交本地设计', kind: 'localSubmit' },
          { id: 'design.run', label: '云端生成', kind: 'run' },
        ];
      if (status === 'DESIGN_WAITING_CONFIRMATION')
        return [
          { id: 'design.confirm', label: '确认设计', kind: 'confirm' },
          { id: 'design.reject', label: '驳回', kind: 'reject', danger: true },
          { id: 'design.revise', label: '发送修改意见', kind: 'revise', needsFeedback: true },
        ];
      return [];
    case 'SPEC_PLAN':
      if (status === 'SPEC_PLAN_PENDING') return [{ id: 'specPlan.run', label: '生成 Spec & Plan', kind: 'run' }];
      if (status === 'SPEC_PLAN_WAITING_CONFIRMATION')
        return [
          { id: 'specPlan.confirm', label: '确认 Spec & Plan', kind: 'confirm' },
          { id: 'specPlan.reject', label: '驳回', kind: 'reject', danger: true },
          { id: 'specPlan.revise', label: '发送修改意见', kind: 'revise', needsFeedback: true },
        ];
      return [];
    case 'EXECUTION':
      if (status === 'EXECUTION_PENDING')
        return [
          { id: 'execution.claim', label: '本地接管执行', kind: 'claim' },
          { id: 'execution.run', label: '云端执行', kind: 'run' },
        ];
      if (status === 'EXECUTION_RUNNING' && execution.claimed)
        return [
          { id: 'execution.complete', label: '上报完成', kind: 'complete' },
          { id: 'execution.cancel', label: '释放本地执行', kind: 'cancel', danger: true },
        ];
      return [];
    case 'AI_REVIEW':
      if (status === 'REVIEW_PENDING') return [{ id: 'review.run', label: '运行 AI 审查', kind: 'run' }];
      return [];
    case 'HUMAN_REVIEW':
      if (status === 'HUMAN_REVIEW_PENDING')
        return [
          { id: 'humanReview.accept', label: '通过', kind: 'decide', decision: 'accept' },
          { id: 'humanReview.rework', label: '打回重做', kind: 'decide', decision: 'rework', danger: true },
        ];
      return [];
    default:
      return [];
  }
}

/** Build a pure, render-ready model of the run's stage timeline + available actions. */
export function buildRunDetailModel(run: WorkflowRunDetail): RunDetailModel {
  const current = currentStageKey(run.status);
  const execution = deriveExecutionClaim(run);

  const timeline: StageTimelineItem[] = STAGES.map(({ key, title }) => {
    const stage = latestStage(run, key);
    const isCurrent = current === key;
    return {
      key,
      title,
      status: stage?.status ?? '—',
      statusMessage: stage?.statusMessage ?? null,
      attempt: stage?.attempt,
      isCurrent,
      actions: isCurrent ? actionsForStage(key, run.status, execution) : [],
    };
  });

  return {
    runId: run.id,
    status: run.status,
    title: run.requirement?.title,
    timeline,
    execution,
  };
}
