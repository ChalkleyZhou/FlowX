export interface WorkflowCollaborationSession {
  id: string;
  stageExecutionId: string;
  stage: string;
  status: string;
  sourceTool: string;
  health: 'UNKNOWN' | 'ONLINE' | 'STALE' | 'TERMINAL';
  controlMode: string;
  claimedByUser: { displayName: string } | null;
  isOwner: boolean;
  canRelease: boolean;
  lastHeartbeatAt: string | null;
  deviceId: string | null;
  summary: string | null;
  blockedReason: string | null;
  errorMessage: string | null;
}

export interface WorkflowCollaboration {
  workflowRunId: string;
  currentStage: string | null;
  sessions: WorkflowCollaborationSession[];
}
