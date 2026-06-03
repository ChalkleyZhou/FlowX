import { join } from 'node:path';

export function getWorkflowArtifactsRoot(workflowRunId: string): string {
  const override = process.env.FLOWX_ARTIFACTS_ROOT?.trim();
  if (override) {
    return join(override, workflowRunId, 'artifacts');
  }
  return join(process.cwd(), '.flowx-data', 'workflows', workflowRunId, 'artifacts');
}
