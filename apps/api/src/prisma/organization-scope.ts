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
  return { kind: 'REQUIREMENT', project: projectScope(organizationId) };
}

function workItemScope(organizationId: string) {
  return { project: projectScope(organizationId) };
}

function workflowScope(organizationId: string) {
  return { workItem: workItemScope(organizationId) };
}

function executionSessionScope(organizationId: string) {
  return {
    OR: [
      { workspace: workspaceScope(organizationId) },
      { workflowRun: workflowScope(organizationId) },
    ],
  };
}

const scopeFactories: Record<string, (organizationId: string) => Record<string, unknown>> = {
  WorkItem: workItemScope,
  Workspace: workspaceScope,
  Project: projectScope,
  ProjectVersion: (organizationId) => ({ project: projectScope(organizationId) }),
  Repository: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  RequirementChange: (organizationId) => ({ workItem: requirementScope(organizationId) }),
  PrototypeImport: (organizationId) => ({ workItem: requirementScope(organizationId) }),
  RequirementAssignment: (organizationId) => ({ workItem: requirementScope(organizationId) }),
  RequirementRepository: (organizationId) => ({ workItem: requirementScope(organizationId) }),
  BriefingSource: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  BriefingEvent: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  BriefingFeed: (organizationId) => ({ project: projectScope(organizationId) }),
  BriefingFeedRepository: (organizationId) => ({ feed: { project: projectScope(organizationId) } }),
  BriefingFeedDeliveryTarget: (organizationId) => ({ feed: { project: projectScope(organizationId) } }),
  CodeReviewFeed: (organizationId) => ({ project: projectScope(organizationId) }),
  CodeReviewFeedRepository: (organizationId) => ({ feed: { project: projectScope(organizationId) } }),
  CodeReviewFeedDeliveryTarget: (organizationId) => ({ feed: { project: projectScope(organizationId) } }),
  DailyCodeReview: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  Briefing: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  DeliveryTarget: (organizationId) => ({ project: projectScope(organizationId) }),
  DeliveryLog: (organizationId) => ({
    deliveryTarget: { project: projectScope(organizationId) },
  }),
  WorkflowRun: workflowScope,
  WorkflowRepository: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  StageExecution: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  ExecutionSession: executionSessionScope,
  ExecutionCommand: (organizationId) => ({ executionSession: executionSessionScope(organizationId) }),
  SyncEvent: (organizationId) => ({
    executionSession: executionSessionScope(organizationId),
  }),
  Artifact: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  Evidence: (organizationId) => ({
    executionSession: executionSessionScope(organizationId),
  }),
  CodeBranchSubmission: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  CodeExecution: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  ReviewReport: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  ReviewFinding: (organizationId) => ({ workflowRun: workflowScope(organizationId) }),
  IdeationSession: (organizationId) => ({ workItem: requirementScope(organizationId) }),
  IdeationSessionEvent: (organizationId) => ({
    session: { workItem: requirementScope(organizationId) },
  }),
  IdeationArtifact: (organizationId) => ({ workItem: requirementScope(organizationId) }),
  Bug: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  TestCaseLibrary: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  TestCaseModule: (organizationId) => ({ library: { workspace: workspaceScope(organizationId) } }),
  TestCaseDefinition: (organizationId) => ({
    library: { workspace: workspaceScope(organizationId) },
  }),
  TestCaseCoverageLink: (organizationId) => ({
    testCaseDefinition: { library: { workspace: workspaceScope(organizationId) } },
  }),
  TestDesign: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  TestDesignWorkItem: (organizationId) => ({
    testDesign: { workspace: workspaceScope(organizationId) },
  }),
  TestDesignWorkflowRun: (organizationId) => ({
    testDesign: { workspace: workspaceScope(organizationId) },
  }),
  TestDesignCandidate: (organizationId) => ({
    testDesign: { workspace: workspaceScope(organizationId) },
  }),
  TestDesignSmokeCase: (organizationId) => ({
    testDesign: { workspace: workspaceScope(organizationId) },
  }),
  QualityTestReport: (organizationId) => ({ testRequest: { workspace: workspaceScope(organizationId) } }),
  QualityProgressEvent: (organizationId) => ({ testExecution: {
    testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
  } }),
  TestRequest: (organizationId) => ({ workspace: workspaceScope(organizationId) }),
  TestRequestWorkItem: (organizationId) => ({
    testRequest: { workspace: workspaceScope(organizationId) },
  }),
  TestRequestWorkflowRun: (organizationId) => ({
    testRequest: { workspace: workspaceScope(organizationId) },
  }),
  TestRequestArtifact: (organizationId) => ({
    testRequest: { workspace: workspaceScope(organizationId) },
  }),
  TestRequestScopeCase: (organizationId) => ({
    testRequest: { workspace: workspaceScope(organizationId) },
  }),
  TestPlan: (organizationId) => ({
    testRequest: { workspace: workspaceScope(organizationId) },
  }),
  TestCaseSnapshot: (organizationId) => ({
    testPlan: { testRequest: { workspace: workspaceScope(organizationId) } },
  }),
  TestRun: (organizationId) => ({
    testPlan: { testRequest: { workspace: workspaceScope(organizationId) } },
  }),
  TestRunCase: (organizationId) => ({
    testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
  }),
  TestRunTarget: (organizationId) => ({
    testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
  }),
  TestExecution: (organizationId) => ({
    testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
  }),
  TestExecutionCaseResult: (organizationId) => ({
    testExecution: {
      testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
    },
  }),
  TestRunCaseLease: (organizationId) => ({
    testRunCase: {
      testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
    },
  }),
  TestResult: (organizationId) => ({
    testRunCase: {
      testRun: { testPlan: { testRequest: { workspace: workspaceScope(organizationId) } } },
    },
  }),
  ExternalIntegration: (organizationId) => ({ organizationId }),
  YunxiaoWebhookDelivery: (organizationId) => ({ organizationId }),
  YunxiaoWebhookRecipient: (organizationId) => ({ organizationId }),
  YunxiaoMemberMapping: (organizationId) => ({ organizationId }),
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
