import type { Requirement } from '../types';

type RequirementWorkflow = NonNullable<Requirement['workflowRuns']>[number];

export function isActiveRequirementWorkflow(run: RequirementWorkflow) {
  return !['DONE', 'FAILED'].includes(run.status);
}

export function getActiveRequirementWorkflows(requirement: Requirement) {
  return (requirement.workflowRuns ?? []).filter(isActiveRequirementWorkflow);
}

export function formatRequirementWorkflowScope(run: RequirementWorkflow & { _count?: { workflowRepositories?: number } }) {
  const names = run.workflowRepositories?.map((repository) => repository.name) ?? [];
  const count = run._count?.workflowRepositories ?? names.length;
  if (!count) return '未记录仓库范围';
  if (!names.length) return `共 ${count} 个仓库（详情可分页查看）`;
  return count > names.length ? `${names.join('、')} 等 ${count} 个仓库（详情可分页查看）` : names.join('、');
}
