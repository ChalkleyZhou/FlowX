export type DeployResolvedJobInput = {
  repositoryId: string;
  projectId?: string | null;
  workflowRunId?: string | null;
  provider: string;
  requestedBy?: string | null;
  env?: string | null;
  branch?: string | null;
  commit?: string | null;
  version?: string | null;
  versionImage?: string | null;
  image?: string | null;
  config: Record<string, unknown>;
  overrides: Record<string, unknown>;
};

export type DeployPreviewResult = {
  provider: string;
  payload: Record<string, unknown>;
};

export type DeployCreateJobResult = {
  provider: string;
  payload: Record<string, unknown>;
  externalJobId?: string | null;
  externalJobUrl?: string | null;
  response?: unknown;
};

export interface DeployProvider {
  readonly id: string;
  readonly label: string;

  preview(input: DeployResolvedJobInput): Promise<DeployPreviewResult>;
  createJob(input: DeployResolvedJobInput): Promise<DeployCreateJobResult>;
}
