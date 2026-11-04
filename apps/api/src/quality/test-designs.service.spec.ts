import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTestDesignCandidateDto } from './dto/test-design.dto';
import { describe, expect, it, vi } from 'vitest';
import { TestDesignsService } from './test-designs.service';

function setup() {
  const transaction = {
    testDesignCandidate: { deleteMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    testDesignSmokeCase: { deleteMany: vi.fn(), createMany: vi.fn() },
    testDesign: { update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
    testCaseLibrary: { findFirst: vi.fn(), create: vi.fn() },
    testCaseDefinition: { update: vi.fn(), create: vi.fn() },
  };
  const prisma = {
    project: { findFirst: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    requirement: { findMany: vi.fn() },
    workflowRun: { findMany: vi.fn() },
    testCaseDefinition: { findMany: vi.fn() },
    testDesignCandidate: { findUnique: vi.fn() },
    testDesign: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  const aiExecutor = { generateTestDesign: vi.fn() };
  const invocationContext = {
    getConfiguredDefaultProvider: vi.fn().mockReturnValue('codex'),
    resolveOnlineProvider: vi.fn().mockResolvedValue('codex'),
    resolveInvocationContext: vi.fn().mockResolvedValue({ codexCredentialSource: 'organization' }),
  };
  const service = new TestDesignsService(prisma as never, aiExecutor as never, invocationContext as never);
  return { service, prisma, transaction, aiExecutor, invocationContext };
}

const design = {
  id: 'design-1',
  revision: 1,
  status: 'NOT_STARTED',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  sourceSummary: { requirementIds: ['req-1'], workflowRunIds: ['workflow-1'], specPlans: [{ spec: { goal: '登录' } }] },
  requirements: [{ requirement: { id: 'req-1', title: '登录', description: '支持登录', acceptanceCriteria: '进入首页' } }],
  workflowRuns: [{ workflowRun: {} }],
  candidates: [],
  smokeCases: [],
};

describe('TestDesignsService', () => {
  it('reuses a design only when requirement and workflow scopes match exactly', async () => {
    const { service, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.projectVersion.findFirst.mockResolvedValue({ id: 'version-1' });
    prisma.requirement.findMany.mockResolvedValue([
      { id: 'req-1', title: '登录', description: '支持登录', acceptanceCriteria: '进入首页' },
      { id: 'req-2', title: '退出', description: '支持退出', acceptanceCriteria: '返回登录页' },
    ]);
    prisma.workflowRun.findMany.mockResolvedValue([
      {
        id: 'workflow-1',
        requirementId: 'req-1',
        codeExecution: null,
        stageExecutions: confirmedSourceStages(),
      },
      {
        id: 'workflow-2',
        requirementId: 'req-2',
        codeExecution: null,
        stageExecutions: confirmedSourceStages(),
      },
    ]);
    prisma.testDesign.findMany.mockResolvedValue([
      {
        ...design,
        requirements: [{ requirementId: 'req-1' }],
        workflowRuns: [{ workflowRunId: 'workflow-1' }],
      },
    ]);
    prisma.testDesign.findFirst.mockResolvedValue({ revision: 4 });
    prisma.testDesign.create.mockResolvedValue({ id: 'design-2', revision: 5 });

    const result = await service.createDesign({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      projectVersionId: 'version-1',
      requirementIds: ['req-1', 'req-2'],
      workflowRunIds: ['workflow-1', 'workflow-2'],
    });

    expect(prisma.testDesign.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 5,
        requirements: { create: [{ requirementId: 'req-1' }, { requirementId: 'req-2' }] },
        workflowRuns: { create: [{ workflowRunId: 'workflow-1' }, { workflowRunId: 'workflow-2' }] },
      }),
    }));
    expect(result).toEqual({ id: 'design-2', revision: 5 });
  });

  it('generates comparable functional and smoke candidates', async () => {
    const { service, prisma, transaction, aiExecutor, invocationContext } = setup();
    const getDesign = vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);
    prisma.testCaseDefinition.findMany.mockResolvedValueOnce([
      {
        id: 'case-1',
        version: 2,
        title: '登录成功',
        priority: 'P1',
        precondition: null,
        steps: ['输入账号'],
        expected: '进入首页',
        tags: [],
        testData: '账号：tester',
        targetKeys: ['web'],
        library: { scope: 'PROJECT', projectId: 'project-1', name: '项目用例库' },
      },
    ]).mockResolvedValueOnce([]);
    prisma.requirement.findMany.mockResolvedValue([{ id: 'req-1', title: '登录', description: '支持登录', acceptanceCriteria: '进入首页' }]);
    prisma.workflowRun.findMany.mockResolvedValue([{ id: 'workflow-1', codeExecution: null, stageExecutions: [{ stage: 'SPEC_PLAN', attempt: 1, output: { spec: { goal: '登录' } } }] }]);
    aiExecutor.generateTestDesign.mockResolvedValue({
      sourceSummary: { generatedBy: 'mock' },
      coverageSummary: { mainFlow: 1 },
      candidates: [{ action: 'REUSE', sourceDefinitionId: 'case-1', sourceVersion: 2, coverageKeys: ['main-flow'], proposedCase: { title: '登录成功', priority: 'P1', steps: ['输入账号'], expected: '进入首页' } }],
      smokeCases: [{ title: '登录冒烟', priority: 'P0', steps: ['登录'], expected: '进入首页', blocking: true, coverageKeys: ['smoke'] }],
      uncoveredItems: [],
    });
    transaction.testDesign.update.mockResolvedValue(undefined);
    transaction.testDesign.findUnique.mockResolvedValue({ ...design, revision: 2, status: 'WAITING_REVIEW' });

    const recipient = { flowxUserId: 'user-1', flowxOrganizationId: 'org-1', displayName: '测试用户' };
    prisma.testDesign.update.mockResolvedValue({ ...design, status: 'GENERATING' });
    const result = await service.generate('design-1', recipient);

    expect(result).toEqual(expect.objectContaining({ status: 'GENERATING' }));
    expect(aiExecutor.generateTestDesign).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(aiExecutor.generateTestDesign).toHaveBeenCalledOnce());
    expect(invocationContext.resolveInvocationContext).toHaveBeenCalledWith('codex', recipient);
    expect(aiExecutor.generateTestDesign).toHaveBeenCalledWith(expect.anything(), { codexCredentialSource: 'organization' });
    expect(prisma.testCaseDefinition.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { status: 'ACTIVE', library: { workspaceId: 'workspace-1', projectId: 'project-1' } },
    }));
    expect(prisma.testCaseDefinition.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { status: 'ACTIVE', library: { workspaceId: 'workspace-1', projectId: null } },
    }));
    await vi.waitFor(() => expect(transaction.testDesignCandidate.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ sourceDefinitionId: 'case-1', action: 'REUSE', proposedCase: expect.objectContaining({ testData: '账号：tester', targetKeys: ['web'] }) })] })));
    expect(transaction.testDesignSmokeCase.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ title: '登录冒烟' })] }));
    expect(transaction.testDesign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'WAITING_REVIEW', generationError: null }),
    }));
    const persisted = transaction.testDesignCandidate.createMany.mock.calls[0][0].data[0];
    const sourceCases = await prisma.testCaseDefinition.findMany.mock.results[0].value;
    getDesign.mockResolvedValue({
      ...design, revision: 2, status: 'WAITING_REVIEW',
      candidates: [{ id: 'candidate-1', ...persisted, resolution: 'ACCEPTED' }],
    } as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh').mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue(sourceCases);
    transaction.testDesign.update.mockResolvedValue({ status: 'CONFIRMED' });
    await expect(service.confirm('design-1', {
      revision: 2, coverageChecks: [], uncoveredItems: [], noSmokeReason: '无适用冒烟场景',
    })).resolves.toEqual({ status: 'CONFIRMED' });
  });

  it('生成抢占必须绑定已读取的选例版本，拒绝范围变更后的旧请求', async () => {
    const { service, prisma, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);
    vi.spyOn(service as never, 'loadCurrentSource' as never).mockResolvedValue({ sourceFingerprint: 'fp', sourceSummary: { specPlans: [{ spec: { goal: '登录' } }] } } as never);
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);
    prisma.testDesign.updateMany.mockImplementation(async (args: { where: { revision?: number } }) => ({ count: args.where.revision === design.revision ? 0 : 1 }));
    await expect(service.generate('design-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.testDesign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ revision: design.revision }) }));
    expect(aiExecutor.generateTestDesign).not.toHaveBeenCalled();
  });

  it('marks generation failed when AI output is invalid', async () => {
    const { service, prisma, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);
    vi.spyOn(service as never, 'loadCurrentSource' as never).mockResolvedValue({
      sourceFingerprint: 'fingerprint',
      sourceSummary: { specPlans: [{ spec: { goal: '登录' } }] },
    } as never);
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);
    aiExecutor.generateTestDesign.mockResolvedValue({ candidates: [], smokeCases: [], uncoveredItems: null });

    prisma.testDesign.update.mockResolvedValue({ ...design, status: 'GENERATING' });
    await expect(service.generate('design-1')).resolves.toEqual(expect.objectContaining({ status: 'GENERATING' }));
    await vi.waitFor(() => expect(prisma.testDesign.update).toHaveBeenLastCalledWith({
      where: { id: 'design-1', revision: 1, status: 'GENERATING' },
      data: { status: 'GENERATION_FAILED', generationError: expect.stringContaining('输出') },
    }));
  });

  it('returns a retryable error and clears generating state when the AI executor fails', async () => {
    const { service, prisma, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);
    vi.spyOn(service as never, 'loadCurrentSource' as never).mockResolvedValue({
      sourceFingerprint: 'fingerprint',
      sourceSummary: { specPlans: [{ spec: { goal: '登录' } }] },
    } as never);
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);
    aiExecutor.generateTestDesign.mockRejectedValue(new Error('CODEX_AUTH_INVALID_ORG_KEY: secret=sk-sensitive'));

    prisma.testDesign.update.mockResolvedValue({ ...design, status: 'GENERATING' });
    await expect(service.generate('design-1')).resolves.toEqual(expect.objectContaining({ status: 'GENERATING' }));
    await vi.waitFor(() => expect(prisma.testDesign.update).toHaveBeenLastCalledWith({
      where: { id: 'design-1', revision: 1, status: 'GENERATING' },
      data: { status: 'GENERATION_FAILED', generationError: expect.stringContaining('凭据') },
    }));
    expect(prisma.testDesign.update.mock.lastCall?.[0].data.generationError).not.toContain('sk-sensitive');
    expect(prisma.testDesign.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'GENERATING', generationError: null }),
    }));
  });

  it('explains a missing Cursor CLI without exposing command output', async () => {
    const { service, prisma, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);
    vi.spyOn(service as never, 'loadCurrentSource' as never).mockResolvedValue({
      sourceFingerprint: 'fingerprint',
      sourceSummary: { specPlans: [{ spec: { goal: '登录' } }] },
    } as never);
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);
    aiExecutor.generateTestDesign.mockRejectedValue(new Error('Cursor CLI is not installed. secret=sk-sensitive'));

    await expect(service.generate('design-1')).resolves.toEqual(expect.objectContaining({ status: 'GENERATING' }));
    await vi.waitFor(() => expect(prisma.testDesign.update).toHaveBeenCalledWith({
      where: { id: 'design-1', revision: 1, status: 'GENERATING' },
      data: { status: 'GENERATION_FAILED', generationError: expect.stringContaining('命令行工具') },
    }));
    expect(prisma.testDesign.update.mock.lastCall?.[0].data.generationError).not.toContain('sk-sensitive');
  });

  it('blocks confirmation while any candidate is unresolved', async () => {
    const { service } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'WAITING_REVIEW',
      candidates: [{ id: 'candidate-1', resolution: 'PENDING', action: 'CREATE', proposedCase: {} }],
      smokeCases: [],
    } as never);

    await expect(service.confirm('design-1', {
      revision: 1,
      coverageChecks: [],
      uncoveredItems: [],
      noSmokeReason: '无适用冒烟场景',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks confirmation before candidates have been generated', async () => {
    const { service } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);

    await expect(service.confirm('design-1', {
      revision: 1,
      coverageChecks: [],
      uncoveredItems: [],
      noCaseReason: '本次无需功能用例',
      noSmokeReason: '本次无需冒烟用例',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not regenerate a design already frozen by a test request', async () => {
    const { service, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'CONFIRMED',
      testRequest: { id: 'request-1' },
    } as never);

    await expect(service.generate('design-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(aiExecutor.generateTestDesign).not.toHaveBeenCalled();
  });

  it('does not allow the same confirmed design to be used by another test request', async () => {
    const { service } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'CONFIRMED',
      testRequest: { id: 'request-1' },
    } as never);

    await expect(service.assertReadyForRequest('design-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('人工补选完整复制测试数据与适用端并可直接确认复用', async () => {
    const { service, prisma, transaction } = setup();
    const source = {
      id: 'case-1', version: 2, title: '登录成功', priority: 'P1', precondition: null,
      steps: ['输入账号'], expected: '进入首页', tags: [], testData: '账号：tester', targetKeys: ['web'],
    };
    let current = { ...design, status: 'WAITING_REVIEW', candidates: [] as unknown[] };
    vi.spyOn(service, 'getDesign').mockImplementation(async () => current as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh').mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue([source]);
    transaction.testDesignCandidate.create.mockImplementation(async ({ data }) => {
      const candidate = { id: 'candidate-1', ...data };
      current = { ...current, revision: 2, candidates: [candidate] };
      return candidate;
    });
    transaction.testDesign.update.mockResolvedValue({ status: 'CONFIRMED' });

    const selected = await service.addCandidates('design-1', { revision: 1, definitionIds: ['case-1'] });
    expect(selected.candidates[0]).toEqual(expect.objectContaining({
      action: 'REUSE', resolution: 'ACCEPTED',
      proposedCase: expect.objectContaining({ testData: '账号：tester', targetKeys: ['web'] }),
    }));
    await expect(service.confirm('design-1', {
      revision: 2, coverageChecks: [], uncoveredItems: [], noSmokeReason: '无适用冒烟场景',
    })).resolves.toEqual({ status: 'CONFIRMED' });
    expect(transaction.testCaseDefinition.update).not.toHaveBeenCalled();
  });

  it('候选优化保存并确认后保留测试数据与适用端', async () => {
    const { service, prisma, transaction } = setup();
    const proposed = {
      title: '登录成功', priority: 'P1', precondition: null, steps: ['输入账号'], expected: '进入首页',
      tags: [], testData: '账号：tester2', targetKeys: ['web', 'android'],
    };
    const candidate = {
      id: 'candidate-1', testDesignId: 'design-1', action: 'REUSE', resolution: 'ACCEPTED',
      sourceDefinitionId: 'case-1', sourceVersion: 2, testDesign: { revision: 1, status: 'WAITING_REVIEW' },
    };
    prisma.testDesignCandidate.findUnique.mockResolvedValue(candidate);
    transaction.testDesignCandidate.update.mockImplementation(async ({ data }) => ({ ...candidate, ...data }));
    transaction.testCaseDefinition.update.mockResolvedValue({ version: 3 });
    transaction.testDesign.update.mockResolvedValue({ status: 'CONFIRMED' });
    const updated = await service.updateCandidate('design-1', 'candidate-1', {
      revision: 1, action: 'OPTIMIZE', resolution: 'ACCEPTED', proposedCase: proposed,
    });
    expect(updated.proposedCase).toEqual(proposed);
    vi.spyOn(service, 'getDesign').mockResolvedValue({ ...design, revision: 2, status: 'WAITING_REVIEW', candidates: [updated] } as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh').mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue([{ id: 'case-1', version: 2 }]);

    await service.confirm('design-1', { revision: 2, coverageChecks: [], uncoveredItems: [], noSmokeReason: '无适用冒烟场景' });
    expect(transaction.testCaseDefinition.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ testData: '账号：tester2', targetKeys: ['android', 'web'] }),
    }));
  });

  it('新建候选未指定元数据时确认显式保存空值', async () => {
    const { service, prisma, transaction } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design, status: 'WAITING_REVIEW', candidates: [{
        id: 'candidate-1', action: 'CREATE', resolution: 'ACCEPTED',
        proposedCase: { title: '登录成功', priority: 'P1', steps: ['输入账号'], expected: '进入首页' },
      }],
    } as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh').mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue([]);
    transaction.testCaseLibrary.findFirst.mockResolvedValue({ id: 'library-1' });
    transaction.testCaseDefinition.create.mockResolvedValue({ id: 'case-1', version: 1 });
    await service.confirm('design-1', { revision: 1, coverageChecks: [], uncoveredItems: [], noSmokeReason: '无适用冒烟场景' });
    expect(transaction.testCaseDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ testData: null, targetKeys: [] }),
    }));
  });

  it.each([
    { testData: 1 },
    { targetKeys: ['web', 1] },
    { targetKeys: 'web' },
  ])('候选更新拒绝无效元数据类型 %j', async (metadata) => {
    const dto = plainToInstance(UpdateTestDesignCandidateDto, {
      revision: 1,
      proposedCase: { title: '登录成功', priority: 'P1', steps: ['输入账号'], expected: '进入首页', ...metadata },
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([{}, { testData: null, targetKeys: [] }, { testData: '账号：tester', targetKeys: ['web'] }])(
    '候选更新兼容可选元数据 %j', async (metadata) => {
      const dto = plainToInstance(UpdateTestDesignCandidateDto, {
        revision: 1,
        proposedCase: { title: '登录成功', priority: 'P1', steps: ['输入账号'], expected: '进入首页', ...metadata },
      });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it('仅修改测试数据或适用端的复用候选也必须转为优化', async () => {
    const { service, prisma } = setup();
    const source = { id: 'case-1', version: 2, title: '登录成功', priority: 'P1', steps: ['输入账号'], expected: '进入首页', testData: '旧数据', targetKeys: ['web'] };
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design, status: 'WAITING_REVIEW', candidates: [{
        id: 'candidate-1', action: 'REUSE', resolution: 'ACCEPTED', sourceDefinitionId: source.id, sourceVersion: source.version,
        proposedCase: { ...source, testData: '新数据', targetKeys: ['android'] },
      }],
    } as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh').mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue([source]);
    await expect(service.confirm('design-1', {
      revision: 1, coverageChecks: [], uncoveredItems: [], noSmokeReason: '无适用冒烟场景',
    })).rejects.toMatchObject({ response: { code: 'TEST_DESIGN_REUSE_CHANGED' } });
  });

  it('requires changed reused content to be confirmed as an optimization', async () => {
    const { service, prisma } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'WAITING_REVIEW',
      candidates: [{
        id: 'candidate-1',
        action: 'REUSE',
        resolution: 'ACCEPTED',
        sourceDefinitionId: 'case-1',
        sourceVersion: 2,
        proposedCase: {
          title: '登录成功',
          priority: 'P1',
          precondition: null,
          steps: ['输入账号', '校验新提示'],
          expected: '进入首页',
          tags: [],
        },
      }],
      smokeCases: [{ resolution: 'ACCEPTED' }],
    } as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh')
      .mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue([{
      id: 'case-1',
      version: 2,
      title: '登录成功',
      priority: 'P1',
      precondition: null,
      steps: ['输入账号'],
      expected: '进入首页',
      tags: [],
    }]);

    await expect(service.confirm('design-1', {
      revision: 1,
      coverageChecks: [],
      uncoveredItems: [],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

function confirmedSourceStages() {
  return [
    { stage: 'BRAINSTORM', attempt: 1, output: { brief: {} } },
    { stage: 'DESIGN', attempt: 1, output: { design: {} } },
    { stage: 'SPEC_PLAN', attempt: 1, output: { spec: {} } },
  ];
}
