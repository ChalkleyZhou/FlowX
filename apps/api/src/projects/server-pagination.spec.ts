import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { RequirementsService } from '../requirements/requirements.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ReviewArtifactsService } from '../review-artifacts/review-artifacts.service';

function service<T extends object>(prototype: T, prisma: unknown): T {
  return Object.assign(Object.create(prototype), { prisma: { workspace:{count:vi.fn().mockResolvedValue(1)},requirement:{count:vi.fn().mockResolvedValue(1)},repository:{count:vi.fn().mockResolvedValue(1)},project:{count:vi.fn().mockResolvedValue(1)}, ...(prisma as object) } });
}

describe('记录浏览使用数据库分页', () => {
  it('HTTP 项目列表即使不提供参数也走分页路径', async () => {
    const findPage = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const controller = new ProjectsController({ findPage } as never, {} as never);
    await controller.findAll();
    expect(findPage).toHaveBeenCalledWith({});
  });

  it('项目列表在数据库执行 skip/take，count 使用同一筛选且不附带无界集合', async () => {
    const project = { findMany: vi.fn().mockResolvedValue([{ id: 'p' }]), count: vi.fn().mockResolvedValue(37) };
    const instance = service(ProjectsService.prototype, { project });
    const result = await instance.findPage({ page: '2', pageSize: '10', workspaceId: 'w', q: '分页' });
    expect(result).toMatchObject({ total: 37, page: 2, pageSize: 10, totalPages: 4 });
    const query = project.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ skip: 10, take: 10, where: { workspaceId: 'w' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(project.count).toHaveBeenCalledWith({ where: query.where });
    expect(query.include.versions).toBeUndefined();
    expect(query.include.workspace).toBe(true);
  });

  it('工作区默认分页并单独分页仓库', async () => {
    const workspace = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(21), findUniqueOrThrow: vi.fn().mockResolvedValue({id:'w'}) };
    const repository = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(42) };
    const instance = service(WorkspacesService.prototype, { workspace, repository });
    expect(await instance.findPage({})).toMatchObject({ total: 21, pageSize: 20 });
    expect(workspace.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
    expect(workspace.findMany.mock.calls[0][0].include.repositories).toBeUndefined();
    expect(await instance.listRepositories('w', {page:'3'})).toMatchObject({total:42,page:3});
    expect(repository.findMany.mock.calls[0][0]).toMatchObject({where:{workspaceId:'w'},skip:40,take:20});
  });

  it.each(['getIssuesPage', 'getBugsPage'] as const)('%s 保持筛选、统计与页大小相互独立', async (method) => {
    const delegate = { findMany: vi.fn().mockResolvedValue([{id:'item'}]), count: vi.fn().mockResolvedValue(50) };
    const instance = service(ReviewArtifactsService.prototype, {issue:delegate,bug:delegate});
    const result = await instance[method]({workspaceId:'w',status:'OPEN',priority:'HIGH',q:'needle',page:'2',pageSize:'5'});
    const query = delegate.findMany.mock.calls[0][0];
    expect(query).toMatchObject({skip:5,take:5,where:{workspaceId:'w',status:'OPEN',priority:'HIGH'}});
    expect(delegate.count).toHaveBeenCalledWith({where:query.where});
    expect(result).toMatchObject({total:50,page:2,pageSize:5,summary:{visible:50}});
  });

  it('需求分页在数据库筛选，汇总不依赖当前页', async () => {
    const requirement = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(31)};
    const project = {count:vi.fn().mockResolvedValue(1)};
    const workspace = {count:vi.fn().mockResolvedValue(1)};
    const instance = service(RequirementsService.prototype,{requirement,project,workspace});
    const result = await instance.findPage({projectId:'p',versionId:'v',planningStatus:'DONE',priority:'LOW',page:'2'});
    expect(requirement.findMany.mock.calls[0][0]).toMatchObject({skip:20,take:20,where:{projectId:'p',versionId:'v',planningStatus:'DONE',priority:'LOW'}});
    expect(result.summary).toMatchObject({requirementCount:31,visibleCount:31});
  });

  it('工作流在数据库按需求和项目筛选，并有稳定排序', async () => {
    const workflowRun = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(30)};
    const instance = service(WorkflowService.prototype,{workflowRun});
    const result = await instance.findPage({projectId:'p',requirementId:'r',runType:'FULL',page:'2'});
    expect(workflowRun.findMany.mock.calls[0][0]).toMatchObject({skip:20,take:20,where:{runType:'FULL',requirementId:'r',requirement:{projectId:'p'}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    expect(result.summary).toMatchObject({total:30,visible:30});
  });
});

import { BriefingsService } from '../briefings/briefings.service';
import { DailyCodeReviewService } from '../daily-code-review/daily-code-review.service';
import { BriefingFeedsService } from '../briefings/briefing-feeds.service';
import { CodeReviewFeedsService } from '../daily-code-review/code-review-feeds.service';
import { BriefingSourcesService } from '../briefings/briefing-sources.service';
import { DeliveryTargetsService } from '../briefings/delivery-targets.service';
import { AuthService } from '../auth/auth.service';
import { PersonalApiTokenService } from '../auth/personal-api-token.service';
import { RequirementChangesService } from '../requirements/requirement-changes.service';
import { RequirementsController } from '../requirements/requirements.controller';
import { WorkflowController } from '../workflow/workflow.controller';
import { ReviewArtifactsController } from '../review-artifacts/review-artifacts.controller';

describe('详情子列表与管理列表分页契约', () => {
  it.each([
    ['briefing', BriefingsService.prototype, 'listProjectBriefingsPage'],
    ['dailyCodeReview', DailyCodeReviewService.prototype, 'listProjectDailyCodeReviewsPage'],
    ['briefingFeed', BriefingFeedsService.prototype, 'listFeedsPage'],
    ['codeReviewFeed', CodeReviewFeedsService.prototype, 'listFeedsPage'],
  ] as const)('%s 列表的默认查询有界且数量使用相同项目条件', async (model, prototype, method) => {
    const delegate = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(120)};
    const instance = service(prototype, {[model]:delegate, project:{findUnique:vi.fn().mockResolvedValue({id:'p'})}});
    const result = await (instance as unknown as Record<string, (id: string, query: object) => Promise<unknown>>)[method]('p', {});
    expect(result).toMatchObject({total:120,page:1,pageSize:20});
    expect(delegate.findMany.mock.calls[0][0]).toMatchObject({where:{projectId:'p'},skip:0,take:20});
    expect(delegate.count).toHaveBeenCalledWith({where:{projectId:'p'}});
  });

  it('投递目标按项目过滤时count与数据查询不偏离', async () => {
    const delegate = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(102)};
    const instance = service(DeliveryTargetsService.prototype,{deliveryTarget:delegate});
    await instance.listTargetsPage({projectId:'p'},{page:'3',pageSize:'30'});
    const query = delegate.findMany.mock.calls[0][0];
    expect(query).toMatchObject({where:{projectId:'p'},skip:60,take:30});
    expect(delegate.count).toHaveBeenCalledWith({where:query.where});
  });

  it('来源、组织成员和个人Token都只读取请求页且保持安全投影', async () => {
    const source = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(50)};
    await service(BriefingSourcesService.prototype,{briefingSource:source}).listSourcesPage('w',{page:'2'});
    expect(source.findMany.mock.calls[0][0]).toMatchObject({skip:20,take:20,where:{workspaceId:'w'}});
    const members = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(51)};
    await service(AuthService.prototype,{userOrganization:members}).listOrganizationMembersPage('o',{page:'2',q:'name'});
    expect(members.findMany.mock.calls[0][0]).toMatchObject({skip:20,take:20,where:{organizationId:'o'}});
    expect(members.count).toHaveBeenCalledWith({where:members.findMany.mock.calls[0][0].where});
    const tokens = {findMany:vi.fn().mockResolvedValue([{id:'t',name:'test',tokenHash:'private',tokenPrefix:'fx',createdAt:new Date(),lastUsedAt:null}]),count:vi.fn().mockResolvedValue(51)};
    const result = await service(PersonalApiTokenService.prototype,{personalApiToken:tokens}).listTokensPage('u','o',{});
    expect(tokens.findMany.mock.calls[0][0]).toMatchObject({where:{userId:'u',organizationId:'o',revokedAt:null},skip:0,take:20});
    expect(result.items[0]).not.toHaveProperty('tokenHash');
  });

  it('需求仓库搜索在数据库过滤全部范围并保持分页count一致', async () => {
    const rows = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(25) };
    await service(RequirementsService.prototype, { requirement: { findUniqueOrThrow: vi.fn() }, requirementRepository: rows }).listRepositoriesPage('r', { q: '后页仓库', page: 2 });
    expect(rows.findMany.mock.calls[0][0]).toMatchObject({ where: { requirementId: 'r', repository: { name: { contains: '后页仓库' } } }, skip: 20, take: 20 });
    expect(rows.count).toHaveBeenCalledWith({ where: rows.findMany.mock.calls[0][0].where });
  });

  it('需求变更从聚合获取全局revision而非当前页最大值，且保留当前流程状态', async () => {
    const changes = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(60),aggregate:vi.fn().mockResolvedValue({_max:{revision:60}})};
    const instance = service(RequirementChangesService.prototype,{
      requirement:{findUnique:vi.fn().mockResolvedValue({id:'r',revision:1})},
      requirementChange:changes,
      workflowRun:{findFirst:vi.fn().mockResolvedValue({aiProvider:'codex',currentStage:'EXECUTION'})},
      stageExecution:{findFirst:vi.fn().mockResolvedValue({status:'RUNNING',input:{requirementRevision:12}})},
    });
    Object.assign(instance,{recoverExpiredStarts:vi.fn()});
    const result = await instance.listPage('r','run',undefined,{page:'3'});
    expect(result).toMatchObject({total:60,page:3,revision:60,contextRevision:12,hasPendingChanges:true});
    expect(changes.findMany.mock.calls[0][0]).toMatchObject({where:{requirementId:'r'},skip:40,take:20});
  });

  it('列表控制器省略查询时仍传入分页默认值', async () => {
    const findPage = vi.fn();
    await new RequirementsController({findPage} as never,{} as never,{} as never).findAll();
    await new WorkflowController({findPage} as never,{} as never).findAll();
    expect(findPage.mock.calls).toEqual([[{}],[{}]]);
    const getIssuesPage=vi.fn(); const getBugsPage=vi.fn();
    const controller = new ReviewArtifactsController({getIssuesPage,getBugsPage} as never);
    await controller.getIssues(); await controller.getBugs();
    expect(getIssuesPage).toHaveBeenCalledWith({}); expect(getBugsPage).toHaveBeenCalledWith({});
  });

  it('活跃流分页在数据库排除终态并拒绝无效布尔筛选', async () => {
    const workflowRun = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(25)};
    const instance = service(WorkflowService.prototype,{workflowRun});
    await instance.findPage({requirementId:'r',activeOnly:'true',page:'2'});
    expect(workflowRun.findMany.mock.calls[0][0]).toMatchObject({where:{requirementId:'r',status:{notIn:['DONE','FAILED']}},skip:20,take:20});
    await expect(instance.findPage({activeOnly:'invalid'})).rejects.toThrow('activeOnly');
  });

  it('工作流类型筛选只影响当前结果，不将项目总数缩成该类型', async () => {
    const workflowRun = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(30) };
    await service(WorkflowService.prototype, { workflowRun }).findPage({ projectId: 'p', runType: 'BUG_FIX' });
    expect(workflowRun.findMany.mock.calls[0][0].where.runType).toBe('BUG_FIX');
    expect(workflowRun.count.mock.calls[1][0].where).not.toHaveProperty('runType');
  });

  it('历史分页包含终态与被变更替代的旧轮，搜索条件不覆盖历史条件', async () => {
    const workflowRun = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(25) };
    await service(WorkflowService.prototype, { workflowRun }).findPage({ requirementId: 'r', terminalOnly: true, q: '旧轮' });
    expect(workflowRun.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ status: { in: ['DONE', 'FAILED'] } }, { supersededByChangeId: { not: null } }] },
      { OR: [{ id: { contains: '旧轮' } }, { requirement: { title: { contains: '旧轮' } } }] },
    ]);
  });

  it('质量入口可按版本筛选并在数据库排除已被变更取代的工作流', async () => {
    const workflowRun = {findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(5)};
    await service(WorkflowService.prototype,{workflowRun}).findPage({projectId:'p',versionId:'v',excludeSuperseded:'true',status:'DONE'});
    expect(workflowRun.findMany.mock.calls[0][0]).toMatchObject({where:{requirement:{projectId:'p',versionId:'v'},supersededByChangeId:null,status:'DONE'},skip:0,take:20});
    expect(workflowRun.count).toHaveBeenCalledWith({where:workflowRun.findMany.mock.calls[0][0].where});
  });

  it('相同创建时间的页边界有唯一ID排序，空页仍返回全范围total', async () => {
    const project={findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(21)};
    const result = await service(ProjectsService.prototype,{project}).findPage({page:'99'});
    expect(result).toMatchObject({items:[],total:21,page:99,totalPages:2});
    expect(project.findMany.mock.calls[0][0].orderBy).toEqual([{createdAt:'desc'},{id:'desc'}]);
  });
});

it('当前项目按ID已失效时返回404，允许Web清除失效范围', async () => {
  const project = {findUnique:vi.fn().mockResolvedValue(null),findUniqueOrThrow:vi.fn().mockRejectedValue(Object.assign(new Error('missing'),{code:'P2025'}))};
  await expect(service(ProjectsService.prototype,{project}).findDetail('missing')).rejects.toMatchObject({status:404});
});

it.each([
  [BriefingFeedsService.prototype,'briefingFeed'],
  [CodeReviewFeedsService.prototype,'codeReviewFeed'],
])('配置搜索与计数使用相同服务端名称条件 %#', async (prototype,delegateName) => {
  const rows={findMany:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0)};
  const instance=service(prototype,{project:{findUnique:vi.fn().mockResolvedValue({id:'p'})},[delegateName]:rows});
  await instance.listFeedsPage('p',{page:2,q:'不存在'});
  expect(rows.findMany).toHaveBeenCalledWith(expect.objectContaining({skip:20,take:20,where:{projectId:'p',name:{contains:'不存在'}}}));
  expect(rows.count).toHaveBeenCalledWith({where:{projectId:'p',name:{contains:'不存在'}}});
});
