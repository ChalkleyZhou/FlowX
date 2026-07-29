import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import { execFile as execFileCallback, spawn } from 'child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import {
  BrainstormInput,
  BrainstormBrief,
  BrainstormOutput,
  ExecuteTaskInput,
  ExecuteTaskOutput,
  GenerateDesignInput,
  GenerateDesignOptions,
  GenerateDesignOutput,
  GenerateSpecPlanInput,
  RepositoryComponentContext,
  RepositoryContext,
  ReviewCodeInput,
  ReviewCodeOutput,
  ReviewDailyChangesInput,
  DailyCodeReviewUnitOutput,
  SpecPlanOutput,
} from '../common/types';
import { assertDesignSpecOutput, assertStrictGenerateDesignOutput } from './design-output-validate';
import { brainstormPrompt } from '../prompts/brainstorm.prompt';
import {
  getDesignJsonSchemaContractBlock,
  getDesignJsonSchemaSummaryContractBlock,
  getDesignSpecSchemaContractBlock,
  getDesignSpecSchemaSummaryContractBlock,
} from '../prompts/design-schema-contract';
import { getBrainstormJsonSchemaContractBlock } from '../prompts/brainstorm-schema-contract';
import {
  designArtifactPrompt,
  designGenerationPrompt,
  openDesignMcpAddon,
} from '../prompts/design-generation.prompt';
import { demoNavPlacementPrompt } from '../prompts/demo-nav-placement.prompt';
import { executionPrompt } from '../prompts/execution.prompt';
import { reviewPrompt } from '../prompts/review.prompt';
import { dailyCodeReviewPrompt } from '../prompts/daily-code-review.prompt';
import { specPlanPrompt } from '../prompts/spec-plan.prompt';
import { BRAINSTORM_MIN_EDGE_CASES, BRAINSTORM_MIN_USER_STORIES } from './brainstorm-schema-limits';
import { AIExecutor, type AIInvocationContext } from './ai-executor';
import { applyDemoNavAgentPatches } from '../common/apply-demo-nav-agent-patches';
import { collectNavAgentSourceExcerpts, resolveDemoNavMenuSpec } from '../common/demo-nav-integration';

const execFile = promisify(execFileCallback);

export function resolveOptionalTimeoutMs(raw: string | undefined, defaultMs: number): number {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === '') {
    return defaultMs;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultMs;
  }
  return parsed;
}

const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS?.trim()) || 600_000;
/** Daily code review can run for a long time; `0` disables wall-clock timeout (default). */
export const CODEX_DAILY_CODE_REVIEW_TIMEOUT_MS = resolveOptionalTimeoutMs(
  process.env.CODEX_DAILY_CODE_REVIEW_TIMEOUT_MS,
  0,
);
const CODEX_DEBUG_ROOT = join(process.cwd(), '.flowx-data', 'codex-debug');
const CODEX_READ_SANDBOX = process.env.CODEX_READ_SANDBOX?.trim() || 'read-only';
const CODEX_WRITE_SANDBOX = process.env.CODEX_WRITE_SANDBOX?.trim() || 'workspace-write';
/** When enabled (and the host ran `od mcp install <agent>`), the design phase prompts the agent to ground the HTML artifact via OpenDesign MCP. */
const OPENDESIGN_MCP_ENABLED = /^(1|true|yes|on)$/i.test(process.env.OPENDESIGN_MCP_ENABLED?.trim() ?? '');
const CODEX_AUTH_ERROR_PATTERNS = [
  /invalid_api_key/i,
  /authentication failed/i,
  /not authenticated/i,
  /401/i,
  /unauthorized/i,
];

export interface StructuredJsonStageOptions {
  timeoutMs?: number;
}

@Injectable()
export class CodexAiExecutor implements AIExecutor {
  private readonly logger = new Logger(CodexAiExecutor.name);
  protected readonly providerName: string = 'codex';
  protected readonly providerLabel: string = 'Codex';
  protected readonly debugRoot: string = CODEX_DEBUG_ROOT;

  async brainstorm(input: BrainstormInput, context?: AIInvocationContext): Promise<BrainstormOutput> {
    const prompt = this.buildBrainstormPrompt(input);
    return this.runJsonStage<BrainstormOutput>(
      'brainstorm.output.schema.json',
      prompt,
      'brainstorm',
      [],
      context,
    );
  }

  /** Read-only structured JSON generation (no target repository context). */
  async runStructuredJsonStage<T>(
    schemaFile: string,
    prompt: string,
    stageName: string,
    context?: AIInvocationContext,
    options?: StructuredJsonStageOptions,
  ): Promise<T> {
    return this.runJsonStage<T>(schemaFile, prompt, stageName, [], context, options);
  }

  async generateDesign(
    input: GenerateDesignInput,
    context?: AIInvocationContext,
    options?: GenerateDesignOptions,
  ): Promise<GenerateDesignOutput> {
    if (options?.phase === 'design') {
      const prompt = this.buildDesignGenerationPrompt(input, options);
      const raw = await this.runJsonStage<unknown>(
        'design-spec.output.schema.json',
        prompt,
        'design artifact generation',
        [],
        context,
      );
      const parsed = assertDesignSpecOutput(raw);
      return {
        design: parsed.design,
        demo: parsed.demo,
        surfaces: parsed.surfaces,
        demoPages: parsed.demoPages ?? [],
      };
    }

    const prompt = this.buildDesignGenerationPrompt(input, options);
    const raw = await this.runJsonStage<unknown>(
      'design-generation.output.schema.json',
      prompt,
      'design generation',
      [],
      context,
    );
    return assertStrictGenerateDesignOutput(raw);
  }

  /**
   * When regex-based menu patching misses, run a schema-constrained JSON stage (same CLI as other stages)
   * on repo excerpts to infer insertAfter anchors.
   */
  async placeDemoNavigation(
    input: {
      repoRoot: string;
      appPackagePrefix: string;
      demoPages: import('../common/types').DemoPage[];
      routerRelativePath?: string;
    },
    context?: AIInvocationContext,
  ): Promise<{ patchedRelativePath?: string; warnings: string[] }> {
    const spec = resolveDemoNavMenuSpec(input.demoPages);
    if (!spec) {
      return { warnings: ['FlowX demo nav agent: could not resolve label/path from demoPages.'] };
    }

    const excerpts = await collectNavAgentSourceExcerpts(
      input.repoRoot,
      input.appPackagePrefix,
      input.routerRelativePath,
    );
    if (excerpts.length === 0) {
      return { warnings: ['FlowX demo nav agent: no source excerpts collected.'] };
    }

    const body = excerpts
      .map((e) => `### ${e.relativePath}\n\n\`\`\`tsx\n${e.excerpt}\n\`\`\`\n`)
      .join('\n');

    const prompt = `${demoNavPlacementPrompt.system}

Target menu label: ${JSON.stringify(spec.label)}
Target path: ${JSON.stringify(spec.hrefPath)}
Router file (hint): ${input.routerRelativePath ?? 'unknown'}

File excerpts (truncated):
${body}
`;

    const raw = await this.runJsonStage<{
      found: boolean;
      patches: Array<{ relativePath: string; insertAfter: string; insertText: string }>;
      notes?: string;
    }>('demo-nav-placement.output.schema.json', prompt, 'demo nav placement', [input.repoRoot], context);

    if (!raw.found || !raw.patches?.length) {
      return {
        warnings: [
          `FlowX demo nav agent: no placement (${raw.notes?.trim() || 'found=false or empty patches'})`,
        ],
      };
    }

    const { written, warnings } = await applyDemoNavAgentPatches(input.repoRoot, raw.patches);
    const notes = raw.notes?.trim();
    return {
      patchedRelativePath: written[0],
      warnings: [
        ...warnings,
        ...(notes ? [`FlowX demo nav agent notes: ${notes}`] : []),
        ...(written.length ? [`FlowX demo nav agent: updated ${written.join(', ')}`] : []),
      ],
    };
  }

  async generateSpecPlan(
    input: GenerateSpecPlanInput,
    context?: AIInvocationContext,
  ): Promise<SpecPlanOutput> {
    const prompt = await this.buildSpecPlanPrompt(input);
    const parsed = await this.runJsonStage<SpecPlanOutput>(
      'spec-plan.output.schema.json',
      prompt,
      'spec plan',
      this.getReadableRepositoryDirs(input.workspace?.repositories),
      context,
    );
    this.assertSpecPlanOutput(parsed);
    return parsed;
  }

  async executeTask(input: ExecuteTaskInput, context?: AIInvocationContext): Promise<ExecuteTaskOutput> {
    const repositories = input.workspace?.repositories.filter(
      (repository) => repository.localPath && repository.syncStatus === 'READY',
    );

    if (!repositories || repositories.length === 0) {
      throw new Error('No prepared workflow repositories are available for execution.');
    }

    for (const repository of repositories) {
      await this.runMutationStage(
        repository.localPath!,
        await this.buildRepositoryExecutionPrompt(input, repository),
        `execution-${repository.name}`,
        context,
      );
    }

    const executionOutput = await this.collectExecutionOutput(repositories);
    if (executionOutput.changedFiles.length === 0) {
      throw new Error(this.buildNoChangeDiagnostic(input, repositories, executionOutput.diffArtifacts));
    }

    return executionOutput;
  }

  async reviewCode(input: ReviewCodeInput, context?: AIInvocationContext): Promise<ReviewCodeOutput> {
    const repositoryDiffSection = this.buildExecutionArtifactSection(
      input.execution.diffArtifacts,
    );

    return this.runJsonStage<ReviewCodeOutput>(
      'review.output.schema.json',
      await this.buildReviewPrompt(input, repositoryDiffSection),
      'review',
      this.getReadableRepositoryDirs(input.workspace?.repositories),
      context,
    );
  }

  async reviewDailyChanges(
    input: ReviewDailyChangesInput,
    context?: AIInvocationContext,
  ): Promise<DailyCodeReviewUnitOutput> {
    // Skill-led whole-repo review may need to resolve sibling repos by name (workspaceRepositoryMap);
    // add every sandboxed repo's localPath to the cwd allowlist, not just the unit's own repo.
    const mapDirs = input.unit.workspaceRepositoryMap?.map((entry) => entry.localPath) ?? [];
    const unitDirs = [input.unit.localPath, ...mapDirs].filter((dir): dir is string => Boolean(dir));
    const repositoryDirs =
      unitDirs.length > 0
        ? Array.from(new Set(unitDirs))
        : this.getReadableRepositoryDirs(input.workspace?.repositories);

    return this.runJsonStage<DailyCodeReviewUnitOutput>(
      'daily-code-review.output.schema.json',
      await this.buildDailyCodeReviewPrompt(input),
      'daily code review',
      repositoryDirs,
      context,
      { timeoutMs: CODEX_DAILY_CODE_REVIEW_TIMEOUT_MS },
    );
  }

  protected async buildSpecPlanPrompt(input: GenerateSpecPlanInput) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'snapshot');
    const liveWorkspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次 Spec&Plan 结果:
${JSON.stringify(input.previousOutput ?? {}, null, 2)}

请根据人工反馈修正上一次结果，并尽量保留仍然合理的部分。`
      : '';

    const brainstormSection = input.brainstormContext
      ? `

已确认的头脑风暴上下文（参考）:
${JSON.stringify(input.brainstormContext, null, 2)}`
      : '';

    const designSection = input.designContext
      ? `

已确认的设计上下文（参考）:
${JSON.stringify(input.designContext, null, 2)}`
      : '';

    return `${specPlanPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。
顶层只允许 spec、plan，以及可选的 notes；不要输出 tasks、demoPages、Markdown 正文或其他额外字段。
spec 描述实现边界：goal、scope、nonGoals、acceptanceCriteria、constraints。
plan 描述实现路径：approach、touchpoints、sequence、risks、verification。
以文档为主，不要强制拆成 tasks 列表；禁止再生成或写入仓库 Demo 页面。
touchpoints 可用模块/服务/页面级描述，不必强制完整文件路径清单。

${specPlanPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
repository grounding:
${workspaceSection}

当前仓库实时结构:
${liveWorkspaceSection}
${revisionSection}
${brainstormSection}
${designSection}
`;
  }

  protected async buildRepositoryExecutionPrompt(
    input: ExecuteTaskInput,
    repository: RepositoryContext,
  ) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

你需要基于这条反馈继续修改当前仓库，而不是回退已完成的合理改动。`
      : '';
    const { spec, plan } = input.specPlan;

    return `${executionPrompt.system}

你正在代码仓库内执行真实开发，请直接修改当前仓库工作区中的代码，不要只输出建议。
当前仓库:
- 名称: ${repository.name}
- URL: ${repository.url}
- 工作分支: ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}

${executionPrompt.user}

目标要求:
- 只在当前仓库内进行必要改动
- 优先落地已确认 Spec&Plan 中与当前仓库相关的部分
- 不要创建与当前仓库无关的改动
- 所有涉及文件的描述都使用当前仓库根目录下的相对路径
- 不要提及 FlowX 编排系统文件或本地绝对路径
- 如果当前仓库存在可实施项，你必须至少落地一个真实文件改动，不能只做分析
- 如果你判断当前仓库不该改，请先检查 Spec&Plan 的 touchpoints 与 sequence 是否真的与当前仓库无关
- 如果最终仍无法修改，请在结束前明确写出阻塞原因，例如“计划触点不存在”或“当前仓库不包含目标模块”
- 完成后不要输出 Markdown，只需结束任务

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}

工作区仓库上下文:
${workspaceSection}
${revisionSection}

已确认 Spec:
- 目标: ${spec.goal}
- 范围:
${spec.scope.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 非目标:
${spec.nonGoals.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 验收标准:
${spec.acceptanceCriteria.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 约束:
${spec.constraints.map((item) => `  - ${item}`).join('\n') || '  - 无'}

已确认 Plan:
- 方案: ${plan.approach}
- 触点:
${plan.touchpoints.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 顺序:
${plan.sequence.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}
- 风险:
${plan.risks.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 验证:
${plan.verification.map((item) => `  - ${item}`).join('\n') || '  - 无'}
`;
  }

  protected async buildReviewPrompt(input: ReviewCodeInput, repositoryDiffSection: string) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const diffSection = repositoryDiffSection
      ? `\n工作流代码差异:\n${repositoryDiffSection}`
      : '';
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次审查结果:
${JSON.stringify(input.previousOutput ?? {}, null, 2)}

请根据人工反馈修正审查结论。`
      : '';
    const { spec, plan } = input.specPlan;

    return `${reviewPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${reviewPrompt.user}

需求信息:
- 标题: ${input.requirement.title}
- 描述: ${input.requirement.description}
- 验收标准: ${input.requirement.acceptanceCriteria}
${workspaceSection}
${revisionSection}

Spec&Plan:
- 目标: ${spec.goal}
- 方案: ${plan.approach}
- 验收标准:
${spec.acceptanceCriteria.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 顺序:
${plan.sequence.map((item, index) => `${index + 1}. ${item}`).join('\n') || '无'}
- 验证:
${plan.verification.map((item) => `  - ${item}`).join('\n') || '  - 无'}

执行结果:
- Patch 摘要: ${input.execution.patchSummary}
- 变更文件:
${input.execution.changedFiles.map((item) => `  - ${item}`).join('\n') || '  - 无'}
- 代码变更条目:
${input.execution.codeChanges
  .map((item, index) => `${index + 1}. ${item.file} | ${item.changeType} | ${item.summary}`)
  .join('\n')}
${diffSection}
`;
  }

  protected async buildDailyCodeReviewPrompt(input: ReviewDailyChangesInput) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspace, 'live');
    const commitLines = input.unit.commits
      .map((commit, index) => {
        const author = commit.author ? ` | ${commit.author}` : '';
        return `${index + 1}. ${commit.id} | ${commit.message.split('\n')[0]}${author}`;
      })
      .join('\n');
    const diffSection = input.unit.commitDiffBundle?.trim()
      ? `

当日 commit diff（由 FlowX 服务端预先收集，仅作可选上下文，不是审查范围的唯一依据）:
${input.unit.commitDiffBundle.trim()}`
      : '';
    const skillSection = input.unit.discoveredSkill
      ? `

FlowX 已在服务端仓库中发现 review skill（路径: ${input.unit.discoveredSkill.relativePath}），请严格按其内容对整仓当前代码树执行本次审查:
${input.unit.discoveredSkill.content.trim()}`
      : '';
    const repositoryMapSection = input.unit.workspaceRepositoryMap?.length
      ? `

workspaceRepositoryMap（工作区仓库名称 → 本地路径映射，如需引用其它仓库请按仓库名称在此解析 localPath，不要依赖磁盘目录名中的 slug-id）:
${JSON.stringify(input.unit.workspaceRepositoryMap, null, 2)}`
      : '';

    return `${dailyCodeReviewPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${dailyCodeReviewPrompt.user}

统计周期: ${input.unit.rangeLabel}
仓库: ${input.unit.repositoryName}
分支: ${input.unit.ref}
本地路径（当前仓库完整代码树，本次审查的主要对象）: ${input.unit.localPath ?? '未提供'}
说明: 请审查 localPath 下当前仓库完整代码树；仓库已同步并已切换到目标分支。下方 commit/diff 仅作可选上下文，无 commit 也必须照常完成整仓审查，不要执行 shell 或 git 命令，严禁修改任何业务文件、执行 git commit 或 git push。
当日 commit（可选上下文）:
${commitLines || '  - 无'}${diffSection}${skillSection}${repositoryMapSection}
${workspaceSection}
`;
  }

  protected async buildRepositoryComponentContext(
    repository: RepositoryContext,
  ): Promise<RepositoryComponentContext | null> {
    if (!repository.localPath || repository.syncStatus !== 'READY') {
      return null;
    }

    try {
      const componentDirs = ['src/components', 'src/components/ui', 'components', 'components/ui', 'app/components'];
      const componentFiles: string[] = [];
      const propTypes: Array<{ name: string; props: string }> = [];
      const pageExamples: Array<{ path: string; code: string }> = [];
      const scanRoots = await this.discoverComponentScanRoots(repository.localPath);
      const maxComponentTsx = 120;

      for (const root of scanRoots) {
        for (const dir of componentDirs) {
          if (componentFiles.length >= maxComponentTsx) {
            break;
          }
          const abs = join(root, dir);
          try {
            await access(abs);
          } catch {
            continue;
          }
          await this.collectTsxRelativePaths(
            repository.localPath,
            abs,
            maxComponentTsx - componentFiles.length,
            10,
            componentFiles,
          );
        }
        if (componentFiles.length >= maxComponentTsx) {
          break;
        }
      }

      const uniqueComponentFiles = Array.from(new Set(componentFiles));

      // Read props from up to 8 key UI components
      const uiComponentFiles = uniqueComponentFiles.filter(
        (f) => f.includes('/ui/') || f.includes('/common/'),
      );
      for (const file of uiComponentFiles.slice(0, 8)) {
        try {
          const content = await readFile(join(repository.localPath, file), 'utf8');
          const propsMatch = content.match(/(?:interface|type)\s+\w*Props\s*(?:=\s*)?{([^}]+)}/s);
          if (propsMatch) {
            const componentName = file.split('/').pop()?.replace('.tsx', '') ?? 'Unknown';
            propTypes.push({ name: componentName, props: propsMatch[1].trim() });
          }
        } catch {
          // skip unreadable files
        }
      }

      const pageDirs = ['src/pages', 'src/app', 'pages', 'app'];
      const pagePaths: string[] = [];
      const maxPagePathGather = 40;
      for (const root of scanRoots) {
        for (const dir of pageDirs) {
          if (pagePaths.length >= maxPagePathGather) {
            break;
          }
          const abs = join(root, dir);
          try {
            await access(abs);
          } catch {
            continue;
          }
          await this.collectTsxRelativePaths(
            repository.localPath,
            abs,
            maxPagePathGather - pagePaths.length,
            12,
            pagePaths,
          );
        }
        if (pagePaths.length >= maxPagePathGather) {
          break;
        }
      }

      const uniquePagePaths = Array.from(new Set(pagePaths));
      for (const relativePath of uniquePagePaths.slice(0, 2)) {
        try {
          const content = await readFile(join(repository.localPath, relativePath), 'utf8');
          pageExamples.push({
            path: relativePath,
            code: content.slice(0, 2000),
          });
        } catch {
          // skip unreadable files
        }
      }

      if (uniqueComponentFiles.length === 0 && pageExamples.length === 0) {
        this.logger.warn(
          `Repository component scan found no .tsx files under known dirs for repo=${repository.name} localPath=${repository.localPath} scanRoots=${scanRoots.length}`,
        );
        return null;
      }

      // Read design tokens if available
      let designTokens: string | undefined;
      const tokenFiles = [
        'src/styles/tokens.css',
        'src/styles/design-tokens.css',
        'src/tokens.css',
        'tailwind.config.ts',
        'tailwind.config.js',
      ];
      for (const tokenFile of tokenFiles) {
        try {
          const content = await readFile(join(repository.localPath, tokenFile), 'utf8');
          designTokens = `// ${tokenFile}\n${content.slice(0, 1500)}`;
          break;
        } catch {
          continue;
        }
      }

      const routingAndAccessHints = await this.buildRoutingAndAccessHints(repository.localPath, scanRoots);

      return {
        componentFiles: uniqueComponentFiles,
        propTypes,
        pageExamples,
        designTokens,
        routingAndAccessHints,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown component context error';
      this.logger.warn(`Failed to build repository component context: ${message}`);
      return null;
    }
  }

  /**
   * Cursor CLI does not enforce --output-schema; reject invalid shapes instead of coercing.
   * Codex relies on CLI schema validation and does not call this by default.
   */
  protected assertStrictBrainstormOutput(raw: unknown): BrainstormOutput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('BRAINSTORM_OUTPUT_INVALID: Brainstorm JSON must be an object.');
    }
    const root = raw as Record<string, unknown>;

    const flatMarkers = [
      'expandedDescription',
      'userStories',
      'edgeCases',
      'successMetrics',
      'openQuestions',
      'assumptions',
      'outOfScope',
    ];
    if (
      (root.brief === undefined || root.brief === null) &&
      flatMarkers.some((key) => Object.prototype.hasOwnProperty.call(root, key))
    ) {
      throw new Error(
        'BRAINSTORM_OUTPUT_INVALID: Brainstorm JSON must nest all fields under top-level "brief" (flat root fields are invalid).',
      );
    }

    if (!root.brief || typeof root.brief !== 'object' || Array.isArray(root.brief)) {
      throw new Error('BRAINSTORM_OUTPUT_INVALID: Missing required top-level property "brief".');
    }

    const b = root.brief as Record<string, unknown>;

    const expandedDescription =
      typeof b.expandedDescription === 'string' ? b.expandedDescription.trim() : '';
    if (!expandedDescription) {
      throw new Error('BRAINSTORM_OUTPUT_INVALID: brief.expandedDescription must be a non-empty string.');
    }

    if (!Array.isArray(b.userStories) || b.userStories.length < BRAINSTORM_MIN_USER_STORIES) {
      throw new Error(
        `BRAINSTORM_OUTPUT_INVALID: brief.userStories must contain at least ${BRAINSTORM_MIN_USER_STORIES} items.`,
      );
    }

    const userStories: BrainstormBrief['userStories'] = [];
    for (let i = 0; i < b.userStories.length; i++) {
      const item = b.userStories[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`BRAINSTORM_OUTPUT_INVALID: brief.userStories[${i}] must be an object.`);
      }
      const row = item as Record<string, unknown>;
      const role = typeof row.role === 'string' ? row.role.trim() : '';
      const action = typeof row.action === 'string' ? row.action.trim() : '';
      const benefit = typeof row.benefit === 'string' ? row.benefit.trim() : '';
      if (!role || !action || !benefit) {
        throw new Error(
          `BRAINSTORM_OUTPUT_INVALID: brief.userStories[${i}] needs non-empty role, action, and benefit strings.`,
        );
      }
      userStories.push({ role, action, benefit });
    }

    type BriefArrayKey = 'edgeCases' | 'successMetrics' | 'openQuestions' | 'assumptions' | 'outOfScope';

    const readStrArr = (field: BriefArrayKey) => {
      const value = b[field];
      if (!Array.isArray(value)) {
        throw new Error(`BRAINSTORM_OUTPUT_INVALID: brief.${field} must be an array of strings.`);
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          throw new Error(`BRAINSTORM_OUTPUT_INVALID: brief.${field}[${i}] must be a string.`);
        }
      }
      return (value as string[]).map((s) => s.trim());
    };

    const edgeCases = readStrArr('edgeCases');
    if (BRAINSTORM_MIN_EDGE_CASES > 0 && edgeCases.length < BRAINSTORM_MIN_EDGE_CASES) {
      throw new Error(
        `BRAINSTORM_OUTPUT_INVALID: brief.edgeCases must contain at least ${BRAINSTORM_MIN_EDGE_CASES} items.`,
      );
    }

    return {
      brief: {
        expandedDescription,
        userStories,
        edgeCases,
        successMetrics: readStrArr('successMetrics'),
        openQuestions: readStrArr('openQuestions'),
        assumptions: readStrArr('assumptions'),
        outOfScope: readStrArr('outOfScope'),
      },
    };
  }

  protected buildBrainstormPrompt(input: BrainstormInput) {
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次头脑风暴结果:
${input.previousBriefs?.length ? JSON.stringify(input.previousBriefs[input.previousBriefs.length - 1], null, 2) : ''}

请根据人工反馈修正产品简报，保留仍然合理的部分。`
      : '';

    const workspaceSection = input.workspaceContext
      ? `\n工作区上下文:\n${input.workspaceContext}`
      : '';

    return `${brainstormPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${brainstormPrompt.user}

${getBrainstormJsonSchemaContractBlock()}

需求信息:
- 标题: ${input.requirementTitle}
- 描述: ${input.requirementDescription}
${workspaceSection}
${revisionSection}
`;
  }

  protected buildDesignGenerationPrompt(input: GenerateDesignInput, options?: GenerateDesignOptions) {
    if (options?.phase === 'design') {
      return this.buildDesignArtifactPrompt(input);
    }
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一次设计方案:
${input.previousDesigns?.length ? JSON.stringify(input.previousDesigns[input.previousDesigns.length - 1], null, 2) : ''}

请根据人工反馈修正设计方案，保留仍然合理的部分。`
      : '';

    const componentContextSection = input.repositoryComponentContext
      ? `

目标仓库组件上下文:

可用组件文件:
${input.repositoryComponentContext.componentFiles.map((f) => `  - ${f}`).join('\n')}

组件 Props 接口:
${input.repositoryComponentContext.propTypes.map((p) => `  ${p.name}:\n    ${p.props.split('\n').join('\n    ')}`).join('\n\n')}

页面模式样例:
${input.repositoryComponentContext.pageExamples.map((p) => `  // ${p.path}\n${p.code.split('\n').map((l) => `  ${l}`).join('\n')}`).join('\n\n')}
${input.repositoryComponentContext.designTokens ? `\n设计 Token:\n${input.repositoryComponentContext.designTokens}` : ''}

请基于以上组件上下文生成 Demo 页面代码。必须使用目标仓库真实存在的组件 import 路径和 Props API。不要引入不存在的组件。`
      : '';

    const routingHintsSection = input.repositoryComponentContext?.routingAndAccessHints
      ? `

路由与权限约定（摘自目标仓库；demoPages 的路由/导航声明方式须对齐）:
${input.repositoryComponentContext.routingAndAccessHints}

路由注册、嵌套路由、懒加载等写法应与仓库一致，勿发明不同的路由 API。Demo 仅用于评审展示：权限相关逻辑应绕过（例如演示路由、全权限 mock、或在既有守卫中对 demo 路径短路），禁止因权限判定隐藏侧边栏、菜单项或页面入口；不要输出「真实鉴权下菜单不可见」的演示效果。`
      : '';

    return `${designGenerationPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${designGenerationPrompt.user}

基于以下已确认的产品简报，生成 UI 设计规格和 Demo 页面代码。
wireframe 使用文字描述布局结构（如 [顶部导航] [侧边栏] [主内容区] [操作栏] 等），
描述需要足够详细，让开发人员可以直接依据它进行开发。

需求信息:
- 标题: ${input.requirementTitle}
- 描述: ${input.requirementDescription}

已确认产品简报:
${JSON.stringify(input.confirmedBrief, null, 2)}
${componentContextSection}${routingHintsSection}
${revisionSection}

${this.providerName === 'cursor' ? getDesignJsonSchemaSummaryContractBlock() : getDesignJsonSchemaContractBlock()}

硬约束:
- 设计阶段禁止输出 API 设计、接口草案、数据模型方案等技术产物。
- JSON 顶层 demoPages 至少 2 条：含单段前缀入口页 + 子场景页；入口用 Link 列子路由；入口 navLabel 可选。有仓库上下文则 import 须真实；否则仅用 React、react-router-dom、DOM。每条含 route、componentName、componentCode、mockData、filePath；具名 export。Demo 仅评审：路由/守卫对齐仓库，演示路径须可达（鉴权短路或等价放行）。
${input.repositoryComponentContext?.routingAndAccessHints ? '\n- 与上文「路由与权限约定」一致；勿换路由 API。' : ''}
`;
  }

  /** 设计阶段（OpenDesign 高保真多端多页 HTML）提示词；产出 design + demo + surfaces，不产 demoPages。 */
  protected buildDesignArtifactPrompt(input: GenerateDesignInput) {
    const revisionSection = input.humanFeedback
      ? `

人工反馈:
${input.humanFeedback}

上一版设计方案:
${input.previousDesigns?.length ? JSON.stringify(input.previousDesigns[input.previousDesigns.length - 1], null, 2) : ''}

请根据人工反馈精修设计稿，保留仍然合理的部分，仅改动反馈指向之处。`
      : '';

    const mcpSection = OPENDESIGN_MCP_ENABLED ? `\n\n${openDesignMcpAddon}` : '';

    return `${designArtifactPrompt.system}

你必须只返回符合 JSON Schema 的 JSON，不要输出解释文字或 Markdown。

${designArtifactPrompt.user}${mcpSection}

需求信息:
- 标题: ${input.requirementTitle}
- 描述: ${input.requirementDescription}

已确认产品简报:
${JSON.stringify(input.confirmedBrief, null, 2)}
${revisionSection}

${this.providerName === 'cursor' ? getDesignSpecSchemaSummaryContractBlock() : getDesignSpecSchemaContractBlock()}

硬约束:
- 只输出 design、demo、surfaces 三个顶层字段；本阶段不要求 demoPages，也不要输出 designArtifact。
- surfaces 至少一端；每端 pages 至少一页；html 必须是完整、自包含文档（<!doctype html> 起始，样式内联）。
- 推荐 surface id：Web端 / 移动端 / 管理后台（按需）。
- 设计阶段禁止输出 API 设计、接口草案、数据模型方案等技术产物。
`;
  }

  private async buildWorkspaceSection(workspace?: {
    name: string;
    description?: string | null;
    repositories: RepositoryContext[];
  } | null, mode: 'snapshot' | 'live' = 'snapshot') {
    if (!workspace) {
      return '\n工作区上下文:\n- 未提供工作区信息';
    }

    const repositorySections = workspace.repositories.length
      ? await Promise.all(
          workspace.repositories.map(async (repository) => {
            const baseLine =
              `  - ${repository.name} | URL: ${repository.url} | 默认分支: ${repository.defaultBranch ?? '未设置'} | 当前分支: ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}\n` +
              `    同步状态: ${repository.syncStatus ?? '未知'}`;
            const snapshot = await this.buildRepositoryContextNarrative(repository, mode);
            return `${baseLine}\n${snapshot}`;
          }),
        )
      : '  - 当前工作区未登记代码库';

    return `
工作区上下文:
- 名称: ${workspace.name}
- 描述: ${workspace.description ?? '无'}
- 代码库:
${Array.isArray(repositorySections) ? repositorySections.join('\n') : repositorySections}`;
  }

  private async buildRepositoryContextNarrative(
    repository: RepositoryContext,
    mode: 'snapshot' | 'live',
  ) {
    if (mode === 'snapshot' && repository.contextSnapshot?.summary) {
      return `    预生成仓库证据(${repository.contextSnapshot.strategy ?? 'unknown'}):\n${repository.contextSnapshot.summary
        .split('\n')
        .map((line) => `      ${line}`)
        .join('\n')}`;
    }

    return this.buildRepositorySnapshot(repository);
  }

  private async buildRepositorySnapshot(repository: RepositoryContext) {
    if (!repository.localPath || repository.syncStatus !== 'READY') {
      return '    仓库快照: 未提供可读的本地副本';
    }

    try {
      const rootEntries = await this.readDirectoryEntries(repository.localPath, 24);
      const focusDirectories = ['apps', 'packages', 'services', 'cmd', 'src', 'internal', 'api', 'web', 'client', 'server', 'pages', 'layouts', 'components', 'tests', 'test'];
      const focusSections = await Promise.all(
        focusDirectories.map(async (dir) => {
          const entries = await this.readDirectoryEntries(join(repository.localPath!, dir), 16);
          return entries.length > 0 ? `    ${dir}/:\n${entries.map((entry) => `      - ${entry}`).join('\n')}` : '';
        }),
      );

      const packageSummary = await this.readPackageJsonSummary(repository.localPath);

      return [
        '    实时仓库结构快照:',
        rootEntries.length > 0
          ? `${rootEntries.map((entry) => `      - ${entry}`).join('\n')}`
          : '      - 无法读取根目录',
        packageSummary ? `    package.json 摘要:\n${packageSummary}` : '',
        ...focusSections.filter(Boolean),
      ]
        .filter(Boolean)
        .join('\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown snapshot error';
      return `    仓库快照读取失败: ${message}`;
    }
  }

  private async readDirectoryEntries(path: string, limit: number) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((entry) => `${entry.isDirectory() ? '[D]' : '[F]'} ${entry.name}`);
    } catch {
      return [];
    }
  }

  /** Depth-first .tsx collection (monorepo pages live under nested dirs, e.g. apps/x/src/pages/foo/bar/index.tsx). */
  private async collectTsxRelativePaths(
    repositoryLocalPath: string,
    absoluteRootDir: string,
    maxFiles: number,
    maxDepth: number,
    into: string[],
  ): Promise<void> {
    const skipDirs = new Set([
      'node_modules',
      'dist',
      'build',
      '.git',
      'coverage',
      '.next',
      'out',
      'storybook-static',
    ]);

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (into.length >= maxFiles || depth > maxDepth) {
        return;
      }
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const ent of sorted) {
        if (into.length >= maxFiles) {
          break;
        }
        const abs = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (skipDirs.has(ent.name)) {
            continue;
          }
          await walk(abs, depth + 1);
        } else if (ent.isFile() && ent.name.endsWith('.tsx')) {
          into.push(relative(repositoryLocalPath, abs).replace(/\\/g, '/'));
        }
      }
    };

    await walk(absoluteRootDir, 0);
  }

  /** Collect .ts/.tsx under route/auth dirs for demo routing alignment (not full repo scan). */
  private async collectTsOrTsxRelativePaths(
    repositoryLocalPath: string,
    absoluteRootDir: string,
    maxFiles: number,
    maxDepth: number,
    into: string[],
  ): Promise<void> {
    const skipDirs = new Set([
      'node_modules',
      'dist',
      'build',
      '.git',
      'coverage',
      '.next',
      'out',
      'storybook-static',
    ]);

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (into.length >= maxFiles || depth > maxDepth) {
        return;
      }
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const ent of sorted) {
        if (into.length >= maxFiles) {
          break;
        }
        const abs = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (skipDirs.has(ent.name)) {
            continue;
          }
          await walk(abs, depth + 1);
        } else if (ent.isFile()) {
          const ok =
            ent.name.endsWith('.tsx') ||
            (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts'));
          if (!ok) {
            continue;
          }
          into.push(relative(repositoryLocalPath, abs).replace(/\\/g, '/'));
        }
      }
    };

    await walk(absoluteRootDir, 0);
  }

  private async buildRoutingAndAccessHints(
    repositoryLocalPath: string,
    scanRoots: string[],
  ): Promise<string | undefined> {
    const routeDirs = [
      'src/router',
      'src/routes',
      'routes',
      'app/routes',
      'src/app/routes',
      'src/middleware',
      'src/guards',
      'src/permissions',
      'src/auth',
    ];
    const gathered: string[] = [];
    outer: for (const root of scanRoots) {
      for (const rd of routeDirs) {
        const abs = join(root, rd);
        try {
          await access(abs);
        } catch {
          continue;
        }
        const paths: string[] = [];
        await this.collectTsOrTsxRelativePaths(repositoryLocalPath, abs, 12, 8, paths);
        gathered.push(...paths);
        if (gathered.length >= 18) {
          break outer;
        }
      }
    }

    const unique = Array.from(new Set(gathered)).slice(0, 10);
    const parts: string[] = [];
    for (const rel of unique) {
      try {
        const content = await readFile(join(repositoryLocalPath, rel), 'utf8');
        parts.push(`// ${rel}\n${content.slice(0, 2000)}`);
      } catch {
        continue;
      }
    }
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join('\n\n---\n\n');
  }

  private async discoverComponentScanRoots(repositoryLocalPath: string): Promise<string[]> {
    const roots = new Set<string>([repositoryLocalPath]);
    const monorepoParents = ['apps', 'packages'];

    for (const parent of monorepoParents) {
      const entries = await this.readDirectoryEntries(join(repositoryLocalPath, parent), 20);
      for (const entry of entries) {
        if (!entry.startsWith('[D] ')) {
          continue;
        }
        roots.add(join(repositoryLocalPath, parent, entry.slice(4)));
      }
    }

    return Array.from(roots);
  }

  private async readPackageJsonSummary(localPath: string) {
    try {
      const packageJson = JSON.parse(await readFile(join(localPath, 'package.json'), 'utf8')) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const scriptNames = Object.keys(packageJson.scripts ?? {}).slice(0, 12);
      const dependencyNames = [
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
      ].slice(0, 20);

      return [
        packageJson.name ? `      - name: ${packageJson.name}` : '',
        scriptNames.length > 0 ? `      - scripts: ${scriptNames.join(', ')}` : '',
        dependencyNames.length > 0 ? `      - dependencies: ${dependencyNames.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }

  protected assertSpecPlanOutput(output: SpecPlanOutput) {
    if (!output?.spec?.goal || !output?.plan?.approach) {
      throw new Error(`${this.providerLabel} output shape is invalid.`);
    }
  }

  protected async runJsonStage<T>(
    schemaFile: string,
    prompt: string,
    stageName: string,
    addDirs: string[] = [],
    context?: AIInvocationContext,
    options?: StructuredJsonStageOptions,
  ): Promise<T> {
    const tempDir = await mkdtemp(join(tmpdir(), 'flowx-codex-'));
    const outputPath = join(tempDir, `${stageName.replace(/\s+/g, '-')}.json`);
    const schemaPath = await this.resolveSchemaPath(schemaFile);
    const addDirArgs = addDirs.flatMap((dir) => ['--add-dir', dir]);
    // When no target repository is provided, isolate Codex from the FlowX repo itself.
    // Otherwise it may accidentally use this service codebase as design context.
    const codexCwd = addDirs[0] ?? tempDir;

    try {
      const { stderr } = await this.runCliProcess(
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          CODEX_READ_SANDBOX,
          '--color',
          'never',
          '--ephemeral',
          '-C',
          codexCwd,
          ...addDirArgs,
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          prompt,
        ],
        codexCwd,
        stageName,
        prompt,
        context,
        options,
      );

      const rawOutput = (await readFile(outputPath, 'utf8')).trim();
      if (!rawOutput) {
        throw new Error(`${this.providerLabel} returned empty output. stderr=${stderr}`);
      }

      return JSON.parse(rawOutput) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown ${this.providerLabel} error`;
      this.logger.error(`${this.providerLabel} ${stageName} failed: ${message}`);
      throw new Error(`${this.providerLabel} ${stageName} failed: ${message}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async resolveSchemaPath(schemaFile: string) {
    const candidates = [
      join(__dirname, schemaFile),
      join(__dirname, '../../src/ai', schemaFile),
      join(process.cwd(), 'src/ai', schemaFile),
      join(process.cwd(), 'dist/ai', schemaFile),
      join(process.cwd(), 'apps/api/src/ai', schemaFile),
      join(process.cwd(), 'apps/api/dist/ai', schemaFile),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new Error(
      `Failed to locate output schema file ${schemaFile}. Checked: ${candidates.join(', ')}`,
    );
  }

  protected async runMutationStage(
    cwd: string,
    prompt: string,
    stageName: string,
    context?: AIInvocationContext,
  ) {
    try {
      await this.runCliProcess(
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          CODEX_WRITE_SANDBOX,
          '--color',
          'never',
          '--ephemeral',
          '-C',
          cwd,
          prompt,
        ],
        cwd,
        stageName,
        prompt,
        context,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unknown ${this.providerLabel} mutation error`;
      this.logger.error(`${this.providerLabel} ${stageName} failed: ${message}`);
      throw new Error(`${this.providerLabel} ${stageName} failed: ${message}`);
    }
  }

  protected runCliProcess(
    args: string[],
    cwd: string,
    stageName: string,
    prompt?: string,
    context?: AIInvocationContext,
    options?: { timeoutMs?: number },
  ) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finished = false;
      const createdAt = new Date().toISOString();
      const timestamp = createdAt.replace(/[:.]/g, '-');
      const stageSlug = stageName.replace(/[^a-z0-9-_]+/gi, '-');
      const artifactPath = join(this.debugRoot, `${timestamp}-${stageSlug}.json`);
      const persistArtifact = (payload: Record<string, unknown>) =>
        this.persistDebugArtifact(artifactPath, {
          provider: this.providerName,
          stageName,
          cwd,
          args,
          prompt,
          createdAt,
          ...payload,
        });

      void persistArtifact({ status: 'STARTED' }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to persist ${this.providerLabel} debug artifact: ${message}`);
      });

      const child = spawn('codex', args, {
        cwd,
        env: this.buildInvocationEnv(context),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timeoutMs = options?.timeoutMs ?? CODEX_TIMEOUT_MS;

      let wallTimeout: ReturnType<typeof setTimeout> | undefined;
      const clearWallTimeout = () => {
        if (wallTimeout) {
          clearTimeout(wallTimeout);
          wallTimeout = undefined;
        }
      };
      if (timeoutMs > 0) {
        wallTimeout = setTimeout(() => {
          if (finished) {
            return;
          }
          finished = true;
          child.kill('SIGTERM');
          void persistArtifact({
            status: 'TIMED_OUT',
            finishedAt: new Date().toISOString(),
            stdout,
            stderr,
            errorMessage: `${this.providerLabel} ${stageName} timed out after ${timeoutMs}ms.`,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to persist timed out ${this.providerLabel} artifact: ${message}`);
          });
          reject(new Error(`${this.providerLabel} ${stageName} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (this.isCodexAuthenticationError(stderr)) {
          if (finished) {
            return;
          }
          finished = true;
          clearWallTimeout();
          child.kill('SIGTERM');
          const errorMessage = this.buildCodexAuthErrorMessage(context);
          void persistArtifact({
            status: 'FAILED',
            finishedAt: new Date().toISOString(),
            stdout,
            stderr,
            errorMessage,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to persist auth failure ${this.providerLabel} artifact: ${message}`);
          });
          reject(new Error(errorMessage));
        }
      });

      child.on('error', (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearWallTimeout();
        void persistArtifact({
          status: 'ERROR',
          finishedAt: new Date().toISOString(),
          stdout,
          stderr,
          errorMessage: error.message,
        }).catch((persistError) => {
          const message =
            persistError instanceof Error ? persistError.message : String(persistError);
          this.logger.warn(`Failed to persist errored ${this.providerLabel} artifact: ${message}`);
        });
        reject(error);
      });

      child.on('close', (code) => {
        if (finished) {
          return;
        }
        finished = true;
        clearWallTimeout();
        if (code === 0) {
          void persistArtifact({
            status: 'COMPLETED',
            finishedAt: new Date().toISOString(),
            exitCode: code,
            stdout,
            stderr,
          }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Failed to persist completed ${this.providerLabel} artifact: ${message}`);
          });
          resolve({ stdout, stderr });
          return;
        }
        void persistArtifact({
          status: 'FAILED',
          finishedAt: new Date().toISOString(),
          exitCode: code,
          stdout,
          stderr,
          errorMessage: `${this.providerLabel} process exited with code ${code}. stderr=${stderr.trim() || 'empty'}`,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to persist failed ${this.providerLabel} artifact: ${message}`);
        });
        reject(
          new Error(
            `${this.providerLabel} process exited with code ${code}. stderr=${stderr.trim() || 'empty'}`,
          ),
        );
      });

      child.stdin.end();
    });
  }

  protected async persistDebugArtifact(
    artifactPath: string,
    payload: Record<string, unknown>,
  ) {
    await mkdir(this.debugRoot, { recursive: true });
    await writeFile(artifactPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  protected async collectExecutionOutput(repositories: RepositoryContext[]): Promise<ExecuteTaskOutput> {
    const changedFiles: string[] = [];
    const codeChanges: ExecuteTaskOutput['codeChanges'] = [];
    const summaryLines: string[] = [];

    for (const repository of repositories) {
      const localPath = repository.localPath;
      if (!localPath) {
        continue;
      }

      const statuses = await this.getRepositoryStatus(localPath);
      if (statuses.length === 0) {
        continue;
      }

      let createdCount = 0;
      let updatedCount = 0;

      for (const item of statuses) {
        const fileLabel = `${repository.name}:${item.path}`;
        changedFiles.push(fileLabel);
        codeChanges.push({
          file: fileLabel,
          changeType: item.changeType,
          summary:
            item.changeType === 'create'
              ? `在 ${repository.name} 中新增 ${item.path}`
              : `在 ${repository.name} 中更新 ${item.path}`,
        });
        if (item.changeType === 'create') {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      summaryLines.push(
        `${repository.name}: 更新 ${updatedCount} 个文件，新增 ${createdCount} 个文件，工作分支 ${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}`,
      );
    }

    return {
      patchSummary: summaryLines.join('\n'),
      changedFiles,
      codeChanges,
      diffArtifacts: await Promise.all(
        repositories.map(async (repository) => {
          const localPath = repository.localPath!;
          const diffStat = await this.getGitDiffStat(localPath);
          const diffText = await this.getGitDiffText(localPath);
          const untrackedFiles = await this.getUntrackedFiles(localPath);

          return {
            repository: repository.name,
            branch: repository.currentBranch ?? repository.defaultBranch ?? '未设置',
            localPath,
            diffStat,
            diffText: this.truncateText(diffText, 12000),
            untrackedFiles,
          };
        }),
      ),
    };
  }

  protected buildNoChangeDiagnostic(
    input: ExecuteTaskInput,
    repositories: RepositoryContext[],
    diffArtifacts: ExecuteTaskOutput['diffArtifacts'],
  ) {
    const { plan } = input.specPlan;

    const repositoryLines = repositories.map((repository) => {
      const artifact = diffArtifacts.find((item) => item.repository === repository.name);
      const diffStat = artifact?.diffStat?.trim() || '无';
      const untracked = artifact?.untrackedFiles?.length
        ? artifact.untrackedFiles.join(', ')
        : '无';

      return `${repository.name} [${repository.currentBranch ?? repository.defaultBranch ?? '未设置'}] diffStat=${diffStat}; untracked=${untracked}`;
    });

    return [
      `${this.providerLabel} execution finished without producing any code changes.`,
      `Spec goal: ${input.specPlan.spec.goal}`,
      `Plan approach: ${plan.approach}`,
      `Plan touchpoints: ${plan.touchpoints.join(', ') || '无'}`,
      `Plan sequence: ${plan.sequence.join(' | ') || '无'}`,
      `Repositories inspected: ${repositoryLines.join(' || ') || '无'}`,
      input.humanFeedback ? `Human feedback: ${input.humanFeedback}` : 'Human feedback: 无',
    ].join(' ');
  }

  protected async getRepositoryStatus(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['status', '--porcelain=v1', '-uall'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    return stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2);
        const rawPath = line.slice(3).trim();
        const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath;
        const changeType =
          status.includes('?') || status.includes('A') ? 'create' : 'update';

        return {
          path,
          changeType: changeType as 'create' | 'update',
        };
      });
  }

  protected buildExecutionArtifactSection(
    artifacts: ExecuteTaskOutput['diffArtifacts'],
  ) {
    return artifacts
      .map((artifact) => {
        const parts = [
          `- ${artifact.repository} | 工作分支: ${artifact.branch}`,
        ];

        if (artifact.diffStat) {
          parts.push(`  diff --stat:\n${artifact.diffStat}`);
        }

        if (artifact.untrackedFiles.length > 0) {
          parts.push(
            `  未跟踪文件:\n${artifact.untrackedFiles.map((file) => `    - ${file}`).join('\n')}`,
          );
        }

        if (artifact.diffText) {
          parts.push(`  diff:\n${artifact.diffText}`);
        }

        return parts.join('\n');
      })
      .join('\n');
  }

  private getReadableRepositoryDirs(repositories?: RepositoryContext[] | null) {
    return (repositories ?? [])
      .filter((repository) => repository.localPath && repository.syncStatus === 'READY')
      .map((repository) => repository.localPath!);
  }

  private async getGitDiffStat(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['diff', '--stat', 'HEAD'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    return stdout.trim();
  }

  private async getGitDiffText(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['diff', '--no-ext-diff', '--unified=3', 'HEAD'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 8,
      },
    );
    return stdout.trim();
  }

  private async getUntrackedFiles(localPath: string) {
    const { stdout } = await execFile(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      {
        cwd: localPath,
        env: process.env,
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private truncateText(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}\n...[truncated]`;
  }

  private buildInvocationEnv(context?: AIInvocationContext) {
    if (!context?.codexApiKey) {
      return process.env;
    }

    return {
      ...process.env,
      OPENAI_API_KEY: context.codexApiKey,
    };
  }

  private isCodexAuthenticationError(stderr: string) {
    return CODEX_AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(stderr));
  }

  private buildCodexAuthErrorMessage(context?: AIInvocationContext) {
    if (context?.codexCredentialSource === 'organization') {
      return 'CODEX_AUTH_INVALID_ORG_KEY: Codex authentication failed for organization-scoped credential. Please update your organization OpenAI API Key.';
    }
    if (context?.codexCredentialSource === 'instance') {
      return 'CODEX_AUTH_INVALID_INSTANCE_KEY: Codex authentication failed for instance OPENAI_API_KEY. Please rotate server credential.';
    }
    return 'CODEX_AUTH_MISSING: Codex authentication failed. Re-run `codex login` on the server, or provide OPENAI_API_KEY.';
  }
}
