import type { Requirement } from '../types';

type RequirementWorkflow = NonNullable<Requirement['workflowRuns']>[number];

export function isActiveRequirementWorkflow(run: RequirementWorkflow) {
  return !['DONE', 'FAILED'].includes(run.status);
}

export function getActiveRequirementWorkflows(requirement: Requirement) {
  return (requirement.workflowRuns ?? []).filter(isActiveRequirementWorkflow);
}

export function formatRequirementWorkflowScope(run: RequirementWorkflow) {
  const names = run.workflowRepositories?.map((repository) => repository.name) ?? [];
  return names.length > 0 ? names.join('、') : '未记录仓库范围';
}
