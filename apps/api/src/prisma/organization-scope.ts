type QueryArguments = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
  create?: Record<string, unknown>;
};

const scopedOperations = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

function workspaceScope(organizationId: string) {
  return { organizationId };
}

function projectScope(organizationId: string) {
  return { workspace: workspaceScope(organizationId) };
}

function requirementScope(organizationId: string) {
  return { project: projectScope(organizationId) };
}

function workflowScope(organizationId: string) {
  return { requirement: requirementScope(organizationId) };
}

const scopeFactories: Record<string, (organizationId: string) => Record<string, unknown>> = {
  Workspace: workspaceScope,
  Project: projectScope,
  ProjectVersion: (organizationId) => ({ project: projectScope(organizationId) }),
  Repository: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  Requirement: requirementScope,
  RequirementAssignment: (organizationId) => ({ requirement: requirementScope(organizationId) }),
  RequirementRepository: (organizationId) => ({ requirement: requirementScope(organizationId) }),
  BriefingSource: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  BriefingEvent: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  CodeReviewSource: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  ProjectBriefingConfig: (organizationId) => ({ project: projectScope(organizationId) }),
  ProjectCodeReviewConfig: (organizationId) => ({ project: projectScope(organizationId) }),
  DailyCodeReview: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  Briefing: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  DeliveryTarget: (organizationId) => ({ project: projectScope(organizationId) }),
  DeliveryLog: (organizationId) => ({
    deliveryTarget: { project: projectScope(organizationId) },
  }),
  WorkflowRun: workflowScope,
  WorkflowRepository: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  StageExecution: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  ExecutionSession: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  SyncEvent: (organizationId) => ({
    executionSession: { workflowRun: workflowScope(organizationId) },
  }),
  Artifact: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  Evidence: (organizationId) => ({
    executionSession: { workflowRun: workflowScope(organizationId) },
  }),
  CodeExecution: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  ReviewReport: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  ReviewFinding: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  Issue: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  IdeationSession: (organizationId) => ({ requirement: requirementScope(organizationId) }),
  IdeationSessionEvent: (organizationId) => ({
    session: { requirement: requirementScope(organizationId) },
  }),
  IdeationArtifact: (organizationId) => ({ requirement: requirementScope(organizationId) }),
  Bug: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  ExternalIntegration: (organizationId) => ({ organizationId }),
  YunxiaoWebhookDelivery: (organizationId) => ({ organizationId }),
};

export function isOrganizationScopedModel(model: string | undefined): boolean {
  return Boolean(model && scopeFactories[model]);
}

function appendScope(
  where: Record<string, unknown> | undefined,
  scope: Record<string, unknown>,
): Record<string, unknown> {
  if (!where) {
    return scope;
  }
  const existingAnd = where.AND;
  const andClauses = Array.isArray(existingAnd)
    ? existingAnd
    : existingAnd
      ? [existingAnd]
      : [];
  return {
    ...where,
    AND: [...andClauses, scope],
  };
}

export function applyOrganizationScope<T>(
  model: string | undefined,
  operation: string,
  args: T,
  organizationId: string,
): T {
  if (!model || !isOrganizationScopedModel(model)) {
    return args;
  }

  const queryArgs = args as QueryArguments;
  if (model === 'Workspace' && operation === 'create') {
    return {
      ...queryArgs,
      data: {
        ...(queryArgs.data as Record<string, unknown>),
        organizationId,
      },
    } as T;
  }
  if (model === 'Workspace' && operation === 'createMany') {
    const rows = Array.isArray(queryArgs.data) ? queryArgs.data : [queryArgs.data ?? {}];
    return {
      ...queryArgs,
      data: rows.map((row) => ({ ...row, organizationId })),
    } as T;
  }
  if (model === 'Workspace' && operation === 'upsert') {
    return {
      ...queryArgs,
      where: appendScope(queryArgs.where, scopeFactories[model](organizationId)),
      create: {
        ...queryArgs.create,
        organizationId,
      },
    } as T;
  }
  if (!scopedOperations.has(operation)) {
    return args;
  }

  return {
    ...queryArgs,
    where: appendScope(queryArgs.where, scopeFactories[model](organizationId)),
  } as T;
}
