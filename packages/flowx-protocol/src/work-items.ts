export const WORK_ITEM_KINDS = ['REQUIREMENT', 'ISSUE'] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export interface WorkItemRef {
  id: string;
  projectId: string;
  versionId: string | null;
  kind: WorkItemKind;
  title: string;
  status: string;
}

export interface ExecutionItemRef {
  id: string;
  executionPlanId: string;
  title: string;
  target: string;
  status: string;
  ownerUserId: string | null;
  required?: boolean;
  dependsOnIds?: string[];
  blockedReason?: string | null;
  cancelReason?: string | null;
  completionEvidence?: Record<string, unknown> | null;
  executionSessionId?: string | null;
}

export interface ClaimExecutionItemInput {
  claimKey: string;
}

export interface CompleteExecutionItemInput {
  claimKey: string;
  summary?: string;
  evidence?: Record<string, unknown>;
}
