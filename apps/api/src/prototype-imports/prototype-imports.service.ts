import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AI_EXECUTOR_REGISTRY, type AIExecutorRegistry } from '../ai/ai-executor';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrototypeArchive, type PrototypeManifest } from './prototype-archive';
import { assertPrototypeAnalysis, type PrototypeAnalysis } from './prototype-analysis';
import { CreatePrototypeImportDto, PrototypeRevisionDto, UpdatePrototypeImportDto } from './dto/prototype-import.dto';

export type PrototypeActor = { user: { id: string; displayName: string }; organization?: { id?: string | null } | null };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function prototypeAnswers(value: unknown, analysis: PrototypeAnalysis): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('澄清答案格式无效。');
  const entries = Object.entries(value);
  if (entries.some(([key, answer]) => !analysis.clarifications.some((item) => item.id === key) || typeof answer !== 'string' || answer.length > 10000)) {
    throw new BadRequestException('澄清答案包含未知问题或内容过长。');
  }
  return Object.fromEntries(entries.map(([key, answer]) => [key, (answer as string).trim()]));
}
export function confirmedPrototypeAnalysis(analysis: PrototypeAnalysis, answers: Record<string, string>): PrototypeAnalysis {
  const clarificationText = analysis.clarifications.filter((item) => answers[item.id]?.trim()).map((item) => `${item.question}：${answers[item.id].trim()}`);
  const openQuestions = analysis.clarifications.filter((item) => !answers[item.id]?.trim()).map((item) => item.question);
  const description = [analysis.description, ...(clarificationText.length ? ['\n已确认业务规则：', ...clarificationText] : [])].join('\n');
  return {
    ...analysis, description,
    brief: { ...analysis.brief, expandedDescription: description, openQuestions, assumptions: [...analysis.brief.assumptions, ...analysis.inferences] },
    design: { ...analysis.design, designRationale: [analysis.design.designRationale, ...clarificationText].join('\n') },
  };
}

@Injectable()
export class PrototypeImportsService implements OnModuleInit {
  private readonly archive = new PrototypeArchive();
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_EXECUTOR_REGISTRY) private readonly executors: AIExecutorRegistry,
    private readonly invocation: AiInvocationContextService,
  ) {}

  async onModuleInit() {
    // 与当前单进程任务模型一致：重启时保留原材料和旧结果，允许显式重试。
    await this.prisma.prototypeImport.updateMany({ where: { status: 'ANALYZING' }, data: { status: 'FAILED', errorMessage: '服务重启中断了整理，原材料已保留，请重试。' } });
  }
  private organization(actor?: PrototypeActor) {
    if (!actor?.user.id || !actor.organization?.id) throw new ForbiddenException('请登录并选择组织。');
    return actor.organization.id;
  }
  async create(dto: CreatePrototypeImportDto, zip: Buffer, name: string, actor?: PrototypeActor) {
    const organizationId = this.organization(actor);
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, workspace: { organizationId } }, include: { workspace: true } });
    if (!project) throw new NotFoundException('项目不存在或无权访问。');
    const versionId = dto.versionId === undefined ? project.currentVersionId : dto.versionId;
    if (dto.versionId !== undefined && (typeof dto.versionId !== 'string' || !dto.versionId.trim() || !await this.prisma.projectVersion.findFirst({ where: { id: dto.versionId, projectId: project.id } }))) {
      throw new BadRequestException('发布版本不存在或不属于当前项目。');
    }
    const id = randomUUID();
    const aiProvider = this.invocation.normalizeAiProvider(dto.aiProvider);
    let manifest: PrototypeManifest;
    try { manifest = await this.archive.save(id, 1, zip, name); }
    catch { throw new BadRequestException('无法读取原型包，请检查 ZIP 格式、文件路径与大小限制。'); }
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const requirement = await tx.requirement.create({ data: { projectId: project.id, workspaceId: project.workspaceId, versionId, title: dto.title?.trim() || name.replace(/\.zip$/i, '') || '导入原型', description: dto.goal?.trim() || '正在根据原型整理需求', acceptanceCriteria: '待原型分析后确认' } });
        return tx.prototypeImport.create({ data: { id, requirementId: requirement.id, aiProvider, goal: dto.goal?.trim() || dto.title?.trim() || '', manifest: json(manifest), answers: {} } });
      });
      this.schedule(record, actor!);
      return this.view(record);
    } catch (error) {
      await this.archive.remove(id, 1);
      throw error;
    }
  }
  async get(id: string, actor?: PrototypeActor) { return this.view(await this.owned(id, actor)); }
  private async owned(id: string, actor?: PrototypeActor) {
    const organizationId = this.organization(actor);
    const record = await this.prisma.prototypeImport.findFirst({ where: { id, requirement: { project: { workspace: { organizationId } } } } });
    if (!record) throw new NotFoundException('原型导入不存在或无权访问。');
    return record;
  }
  private view(record: Awaited<ReturnType<PrototypeImportsService['owned']>>) {
    return { ...record, manifest: record.manifest as unknown as PrototypeManifest, analysis: record.analysis ? assertPrototypeAnalysis(record.analysis) : null, answers: (record.answers ?? {}) as Record<string, string> };
  }
  private assertEditable(record: { status: string; revision: number }, revision: number) {
    if (record.revision !== revision || !['FAILED', 'WAITING_CONFIRMATION'].includes(record.status)) throw new ConflictException('整理状态或版本已变化，请刷新后重试。');
  }
  private validated(record: Awaited<ReturnType<PrototypeImportsService['owned']>>, dto: UpdatePrototypeImportDto) {
    const manifest = record.manifest as unknown as PrototypeManifest;
    let analysis: PrototypeAnalysis;
    try { analysis = assertPrototypeAnalysis(dto.analysis ?? record.analysis, manifest.files.map((file) => file.path)); }
    catch { throw new BadRequestException('需求与设计草稿格式无效，请重新整理。'); }
    if (record.analysis && dto.analysis) {
      const previous = assertPrototypeAnalysis(record.analysis);
      if (JSON.stringify(analysis.clarifications) !== JSON.stringify(previous.clarifications) || JSON.stringify(analysis.evidence) !== JSON.stringify(previous.evidence)) {
        throw new BadRequestException('澄清问题与来源依据请通过 AI 重新整理，不能直接覆盖。');
      }
    }
    const answers = prototypeAnswers(dto.answers ?? record.answers ?? {}, analysis);
    return { analysis, answers };
  }
  async save(id: string, dto: UpdatePrototypeImportDto, actor?: PrototypeActor) {
    const record = await this.owned(id, actor);
    this.assertEditable(record, dto.revision);
    const { analysis, answers } = this.validated(record, dto);
    const saved = await this.prisma.prototypeImport.updateMany({ where: { id, revision: dto.revision, status: record.status }, data: { analysis: json(analysis), answers, revision: { increment: 1 } } });
    if (saved.count !== 1) throw new ConflictException('草稿已被更新，请刷新。');
    return this.get(id, actor);
  }
  async analyze(id: string, dto: UpdatePrototypeImportDto, actor?: PrototypeActor) {
    const record = await this.owned(id, actor);
    this.assertEditable(record, dto.revision);
    const draft = record.analysis || dto.analysis ? this.validated(record, dto) : null;
    const claimed = await this.prisma.prototypeImport.updateMany({ where: { id, revision: dto.revision, status: record.status }, data: { status: 'ANALYZING', revision: { increment: 1 }, errorMessage: null, ...(draft ? { analysis: json(draft.analysis), answers: draft.answers } : {}) } });
    if (claimed.count !== 1) throw new ConflictException('整理已开始，请刷新。');
    const next = await this.owned(id, actor);
    this.schedule(next, actor!, dto.feedback);
    return this.view(next);
  }
  async supplement(id: string, dto: PrototypeRevisionDto, zip: Buffer, name: string, actor?: PrototypeActor) {
    const record = await this.owned(id, actor);
    this.assertEditable(record, dto.revision);
    const materialRevision = dto.revision + 1;
    const claimed = await this.prisma.prototypeImport.updateMany({ where: { id, revision: dto.revision, status: record.status }, data: { status: 'ANALYZING', revision: { increment: 1 }, errorMessage: null } });
    if (claimed.count !== 1) throw new ConflictException('材料已变化，请刷新。');
    try {
      const manifest = await this.archive.save(id, materialRevision, zip, name, record.materialRevision);
      const changed = await this.prisma.prototypeImport.updateMany({ where: { id, revision: materialRevision, status: 'ANALYZING' }, data: { manifest: json(manifest), materialRevision } });
      if (changed.count !== 1) throw new ConflictException('材料版本已变化。');
      const next = await this.owned(id, actor);
      this.schedule(next, actor!);
      return this.view(next);
    } catch {
      await this.archive.remove(id, materialRevision);
      await this.prisma.prototypeImport.updateMany({ where: { id, revision: materialRevision, status: 'ANALYZING' }, data: { status: 'FAILED', errorMessage: '补传包读取失败，原有材料已保留。请检查 ZIP 格式、路径与大小限制。' } });
      throw new BadRequestException('补传包读取失败，原有材料已保留。');
    }
  }
  async confirm(id: string, dto: UpdatePrototypeImportDto, actor?: PrototypeActor) {
    const record = await this.owned(id, actor);
    this.assertEditable(record, dto.revision);
    if (record.status !== 'WAITING_CONFIRMATION') throw new BadRequestException('请先完成 AI 整理再确认。');
    const { analysis, answers } = this.validated(record, dto);
    if (analysis.clarifications.some((item) => item.required && !answers[item.id]?.trim())) throw new BadRequestException('请先回答影响研发的关键问题。');
    const confirmed = confirmedPrototypeAnalysis(analysis, answers);
    try { assertPrototypeAnalysis(confirmed); }
    catch { throw new BadRequestException('合并后的需求说明过长，请精简草稿或答案后确认。'); }
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.prototypeImport.updateMany({ where: { id, status: 'WAITING_CONFIRMATION', revision: dto.revision }, data: { status: 'CONFIRMED', revision: { increment: 1 }, analysis: json(confirmed), answers, confirmedBy: actor!.user.id, confirmedAt: new Date() } });
      if (changed.count !== 1) throw new ConflictException('版本已变化或已确认，请刷新。');
      await tx.requirement.update({ where: { id: record.requirementId }, data: { title: confirmed.title, description: confirmed.description, acceptanceCriteria: confirmed.acceptanceCriteria.map((text) => `- ${text}`).join('\n'), ideationStatus: 'FINALIZED' } });
      await tx.ideationArtifact.createMany({ data: [{ requirementId: record.requirementId, type: 'BRAINSTORM_BRIEF', content: json(confirmed.brief) }, { requirementId: record.requirementId, type: 'DESIGN_SPEC', content: json(confirmed.design) }] });
    });
    return this.get(id, actor);
  }
  async preview(id: string, path: string, actor?: PrototypeActor) {
    const record = await this.owned(id, actor);
    const manifest = record.manifest as unknown as PrototypeManifest;
    if (!manifest.pages.some((page) => page.path === path)) throw new NotFoundException('原型页面不存在。');
    try { return await this.archive.preview(id, record.materialRevision, path); }
    catch { throw new BadRequestException('该文件暂时无法预览，可下载原包查看。'); }
  }
  async download(id: string, revision: number | undefined, actor?: PrototypeActor) {
    const record = await this.owned(id, actor);
    const sources = (record.manifest as unknown as PrototypeManifest).sources;
    const target = revision ?? sources[sources.length - 1]?.revision;
    if (!target || !sources.some((source) => source.revision === target)) throw new NotFoundException('原始包不存在。');
    return this.archive.download(id, target);
  }
  private schedule(record: Awaited<ReturnType<PrototypeImportsService['owned']>>, actor: PrototypeActor, feedback?: string) {
    setTimeout(() => { void this.runAnalysis(record, actor, feedback).catch(() => undefined); }, 0);
  }
  private async runAnalysis(record: Awaited<ReturnType<PrototypeImportsService['owned']>>, actor: PrototypeActor, feedback?: string) {
    try {
      const executor = this.executors.get(this.invocation.normalizeAiProvider(record.aiProvider));
      if (!executor.analyzePrototype) throw new Error('PROTOTYPE_ANALYSIS_UNAVAILABLE');
      const material = await this.archive.context(record.id, record.materialRevision);
      const context = await this.invocation.resolveInvocationContext(record.aiProvider, { flowxUserId: actor.user.id, displayName: actor.user.displayName, flowxOrganizationId: actor.organization!.id });
      const previous = record.analysis ? assertPrototypeAnalysis(record.analysis) : undefined;
      const raw = await executor.analyzePrototype({ goal: record.goal, material, previous, feedback, answers: (record.answers ?? {}) as Record<string, string> }, context);
      const manifest = record.manifest as unknown as PrototypeManifest;
      const analysis = assertPrototypeAnalysis(raw, manifest.files.map((file) => file.path));
      const oldAnswers = (record.answers ?? {}) as Record<string, string>;
      // 只有问题 ID 和正文都相同才沿用旧答案，避免 AI 复用 ID 后把回答套到另一个问题。
      const answers = Object.fromEntries(analysis.clarifications.filter((item) => previous?.clarifications.some((old) => old.id === item.id && old.question === item.question) && oldAnswers[item.id]).map((item) => [item.id, oldAnswers[item.id]]));
      await this.prisma.prototypeImport.updateMany({ where: { id: record.id, revision: record.revision, status: 'ANALYZING' }, data: { status: 'WAITING_CONFIRMATION', analysis: json(analysis), answers, errorMessage: null } });
    } catch {
      await this.prisma.prototypeImport.updateMany({ where: { id: record.id, revision: record.revision, status: 'ANALYZING' }, data: { status: 'FAILED', errorMessage: 'AI 整理未完成，材料和已有草稿已保留。请检查组织 AI 配置后重试，或补充更完整的原型包。' } });
    }
  }
}
