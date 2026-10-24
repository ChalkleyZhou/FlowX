import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AI_EXECUTOR_REGISTRY, type AIExecutorRegistry } from '../ai/ai-executor';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import { PrototypeArchive, type PrototypeManifest } from '../prototype-imports/prototype-archive';
import { assertPrototypeAnalysis } from '../prototype-imports/prototype-analysis';
import { confirmedPrototypeAnalysis, type PrototypeActor } from '../prototype-imports/prototype-imports.service';
import type { PrototypeWorkflowSnapshot } from '../workflow/workflow-prototype-import';
import type { ChangePrototype } from './requirement-change-prototype';

@Injectable()
export class RequirementChangePrototypeService {
  private readonly archive = new PrototypeArchive();
  constructor(
    @Inject(AI_EXECUTOR_REGISTRY) private readonly executors: AIExecutorRegistry,
    private readonly invocation: AiInvocationContextService,
  ) {}

  async store(zip: Buffer, name: string, aiProvider?: string): Promise<ChangePrototype> {
    const provider = this.invocation.normalizeAiProvider(aiProvider);
    if (provider !== 'codex' && provider !== 'cursor') throw new BadRequestException('请选择 Codex 或 Cursor。');
    const archiveId = randomUUID();
    let manifest: PrototypeManifest;
    try { manifest = await this.archive.save(archiveId, 1, zip, name); }
    catch { throw new BadRequestException('无法读取原型 ZIP，原流程未改变。请检查格式与大小限制。'); }
    return { archiveId, name, sha256: createHash('sha256').update(zip).digest('hex'), aiProvider: provider, manifest };
  }

  async analyze(prototype: ChangePrototype, goal: string, actor: PrototypeActor): Promise<PrototypeWorkflowSnapshot> {
    const executor = this.executors.get(prototype.aiProvider);
    if (!executor.analyzePrototype) throw new Error('PROTOTYPE_ANALYSIS_UNAVAILABLE');
    const context = await this.invocation.resolveInvocationContext(prototype.aiProvider, {
      flowxUserId: actor.user.id, displayName: actor.user.displayName, flowxOrganizationId: actor.organization!.id,
    });
    const material = await this.archive.context(prototype.archiveId, 1);
    const raw = await executor.analyzePrototype({ goal, material, answers: {} }, context);
    const analysis = confirmedPrototypeAnalysis(assertPrototypeAnalysis(raw, prototype.manifest.files.map(file => file.path)), {});
    assertPrototypeAnalysis(analysis);
    return { source: 'prototype-import', importId: prototype.archiveId, revision: 1, materialRevision: 1,
      confirmedBy: null, confirmedAt: new Date().toISOString(), analysis };
  }

  async remove(prototype: ChangePrototype) { await this.archive.remove(prototype.archiveId, 1); }
  async download(prototype: ChangePrototype) { return this.archive.download(prototype.archiveId, 1); }
}
