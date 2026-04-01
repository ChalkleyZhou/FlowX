import type { WorkflowRun } from '../types';

export function getStage(run: WorkflowRun, stage: string) {
  return run.stageExecutions
    .filter((item) => item.stage === stage)
    .sort((a, b) => b.attempt - a.attempt)[0];
}

export function formatStageExecutionStatus(status: string) {
  const map: Record<string, string> = {
    PENDING: '待执行',
    RUNNING: '执行中',
    COMPLETED: '已完成',
    FAILED: '执行失败',
    WAITING_CONFIRMATION: '待人工确认',
    REJECTED: '已驳回',
  };

  return map[status] ?? status;
}

export function formatWorkflowStatus(status: string) {
  const map: Record<string, string> = {
    CREATED: '已创建',
    REPOSITORY_GROUNDING_PENDING: '待仓库 grounding',
    TASK_SPLIT_PENDING: '待任务拆解',
    TASK_SPLIT_WAITING_CONFIRMATION: '待确认任务拆解',
    TASK_SPLIT_CONFIRMED: '任务拆解已确认',
    PLAN_PENDING: '待生成方案',
    PLAN_WAITING_CONFIRMATION: '待确认技术方案',
    PLAN_CONFIRMED: '技术方案已确认',
    EXECUTION_PENDING: '待执行开发',
    EXECUTION_RUNNING: '开发执行中',
    REVIEW_PENDING: '待 AI 审查',
    HUMAN_REVIEW_PENDING: '待人工评审',
    DONE: '已完成',
    FAILED: '失败',
  };
  return map[status] ?? status;
}
