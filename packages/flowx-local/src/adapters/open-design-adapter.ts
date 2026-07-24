import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainstormCompletionReport, DesignCompletionReport } from '@flowx-ai/protocol';
import { writeActiveDesignSession } from '../active-design-session.js';
import type { LocalConfig } from '../config.js';
import { EdgeClient, type RedeemedOpenDesignLaunch } from '../edge-client.js';
import { openOpenDesignWorkspace } from '../open-design-app.js';
import { writeWorkflowBinding } from '../workflow-binding.js';
import type { ToolAdapter } from './tool-adapter.js';

type StoredDesignSession = {
  executionSessionId: string;
  workflowRunId: string;
  apiBaseUrl: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  resultPath: string;
  stage: 'brainstorm' | 'design';
};

export type OpenDesignLaunchResult = {
  ok: true;
  executionSessionId: string;
  workflowRunId: string;
  workspacePath: string;
  contextPath: string;
  resultPath: string;
  opened: boolean;
  imported: boolean;
  importError?: string;
  activeDesignPath: string;
  stage: 'brainstorm' | 'design';
};

export class OpenDesignAdapter
  implements ToolAdapter<RedeemedOpenDesignLaunch, OpenDesignLaunchResult>
{
  readonly name = 'opendesign';
  readonly capabilities = ['context-import', 'artifact-export', 'completion-report'] as const;

  constructor(
    private readonly config: LocalConfig,
    private readonly edgeClient: EdgeClient,
    private readonly homeDir = homedir(),
    private readonly openWorkspace: typeof openOpenDesignWorkspace = openOpenDesignWorkspace,
  ) {}

  async launch(input: RedeemedOpenDesignLaunch): Promise<OpenDesignLaunchResult> {
    const sessionId = input.handoff.executionSessionId;
    const workflowRunId = input.handoff.workflowRunId;
    const stage = resolveStage(input);
    // Credential / fallback artifact dir only — not the designer's Open Design project root.
    const workspacePath = this.sessionRoot(sessionId);
    const contextPath = join(workspacePath, 'context.json');
    const resultFileName =
      stage === 'brainstorm'
        ? 'spec.md'
        : input.handoff.contextPackage.outputContract.resultFileName;
    const resultPath = join(workspacePath, resultFileName);
    await mkdir(workspacePath, { recursive: true });
    await writeFile(contextPath, `${JSON.stringify(input.handoff.contextPackage, null, 2)}\n`, 'utf8');
    if (stage === 'brainstorm') {
      await writeInitialMarkdown(resultPath);
    } else {
      await writeInitialResult(resultPath, input.handoff.executionSessionId);
    }
    await writeFile(
      join(workspacePath, 'README.md'),
      buildInstructions(workflowRunId, input.handoff.executionSessionId, stage),
      'utf8',
    );
    await writeFile(
      join(workspacePath, 'session.json'),
      `${JSON.stringify(
        {
          executionSessionId: sessionId,
          workflowRunId,
          apiBaseUrl: input.apiBaseUrl,
          accessToken: input.accessToken,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          resultPath,
          stage,
        } satisfies StoredDesignSession,
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    const activeDesignPath = await writeActiveDesignSession(
      {
        workflowRunId,
        executionSessionId: sessionId,
        apiBaseUrl: input.apiBaseUrl,
        accessToken: input.accessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        stage,
      },
      this.homeDir,
    );
    await writeWorkflowBinding(
      {
        workflowRunId,
        stage,
        executionSessionId: sessionId,
        ...(input.handoff.contextPackage.requirement?.title
          ? { requirementTitle: input.handoff.contextPackage.requirement.title }
          : {}),
      },
      this.homeDir,
    );

    const opened = await this.openWorkspace(workspacePath, {
      openDesignCommand: this.config.openDesignCommand,
      // Directory is chosen inside Open Design; FlowX only opens the app.
      skipImport: true,
    });

    return {
      ok: true,
      executionSessionId: sessionId,
      workflowRunId,
      workspacePath,
      contextPath,
      resultPath,
      opened: opened.opened,
      imported: false,
      activeDesignPath,
      stage,
      ...(opened.importError ? { importError: opened.importError } : {}),
    };
  }

  async submit(executionSessionId: string) {
    const session = await this.loadSession(executionSessionId);
    if (session.stage === 'brainstorm') {
      const markdown = await readBrainstormMarkdown(session.resultPath);
      const report: BrainstormCompletionReport = {
        idempotencyKey: `brainstorm:${executionSessionId}:v1`,
        markdown,
      };
      if (!report.markdown.trim()) {
        throw new Error('OpenDesign spec.md (or legacy brainstorm.md) is empty.');
      }
      return this.edgeClient.submitBrainstorm({
        apiBaseUrl: session.apiBaseUrl,
        accessToken: session.accessToken,
        executionSessionId,
        report,
      });
    }
    const report = JSON.parse(await readFile(session.resultPath, 'utf8')) as DesignCompletionReport;
    validateReport(report);
    return this.edgeClient.submitDesign({
      apiBaseUrl: session.apiBaseUrl,
      accessToken: session.accessToken,
      executionSessionId,
      report,
    });
  }

  async loadAccessToken(executionSessionId: string) {
    return (await this.loadSession(executionSessionId)).accessToken;
  }

  private async loadSession(executionSessionId: string): Promise<StoredDesignSession> {
    const raw = JSON.parse(
      await readFile(join(this.sessionRoot(executionSessionId), 'session.json'), 'utf8'),
    ) as Partial<StoredDesignSession>;
    return {
      executionSessionId: raw.executionSessionId ?? executionSessionId,
      workflowRunId: raw.workflowRunId ?? '',
      apiBaseUrl: raw.apiBaseUrl ?? '',
      accessToken: raw.accessToken ?? '',
      accessTokenExpiresAt: raw.accessTokenExpiresAt ?? '',
      resultPath: raw.resultPath ?? '',
      stage: raw.stage === 'brainstorm' ? 'brainstorm' : 'design',
    };
  }

  private sessionRoot(executionSessionId: string) {
    return join(
      this.homeDir,
      '.flowx',
      'design-sessions',
      executionSessionId.replace(/[^a-zA-Z0-9._-]/g, '-'),
    );
  }
}

function resolveStage(input: RedeemedOpenDesignLaunch): 'brainstorm' | 'design' {
  if (input.stage === 'brainstorm' || input.kind === 'opendesign-brainstorm') {
    return 'brainstorm';
  }
  const format = input.handoff.contextPackage.outputContract.format;
  if (format === 'flowx-brainstorm-markdown-v1') {
    return 'brainstorm';
  }
  return 'design';
}

function buildResultTemplate(executionSessionId: string): DesignCompletionReport {
  return {
    idempotencyKey: `design:${executionSessionId}:v1`,
    summary: '',
    output: {
      design: {
        overview: '',
        pages: [],
        demoScenario: '',
        designRationale: '',
      },
      demo: {
        summary: '',
        flows: [],
        scope: { included: [], excluded: [] },
        knownGaps: [],
      },
      designArtifact: { html: '<!doctype html><html><body></body></html>' },
    },
  };
}

async function writeInitialResult(resultPath: string, executionSessionId: string) {
  try {
    await writeFile(
      resultPath,
      `${JSON.stringify(buildResultTemplate(executionSessionId), null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

async function writeInitialMarkdown(resultPath: string) {
  try {
    await writeFile(
      resultPath,
      [
        '# Product spec',
        '',
        'Follow the `flowx-brainstorm-spec` Skill: clarify with the user, write this `spec.md`,',
        'show it for confirmation, then call `flowx_submit_brainstorm` only after they confirm.',
        '',
        '## Background',
        '',
        '## Goals',
        '',
        '## Non-goals',
        '',
        '## Requirements',
        '',
        '## Acceptance criteria',
        '',
      ].join('\n'),
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

async function readBrainstormMarkdown(resultPath: string): Promise<string> {
  const root = dirname(resultPath);
  const candidates = [resultPath, join(root, 'spec.md'), join(root, 'brainstorm.md')];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const content = await readFile(candidate, 'utf8');
      if (content.trim()) {
        return content;
      }
    } catch {
      // try next candidate
    }
  }
  return '';
}

function isAlreadyExists(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}

function buildInstructions(
  workflowRunId: string,
  executionSessionId: string,
  stage: 'brainstorm' | 'design',
) {
  if (stage === 'brainstorm') {
    return `# FlowX OpenDesign 本地产品构思

本目录只保存 FlowX 会话凭据与调试副本，**不是**你的 Open Design 工程目录。

推荐流程（与用户级 Skill \`flowx-brainstorm-spec\` 一致；请先运行 \`flowx-local setup\`）：
1. 在 Open Design 中打开或创建你自己的项目目录。
2. 通过 FlowX MCP 拉取上下文：
   - \`flowx_get_active_design_session\`
   - \`flowx_get_brainstorm_handoff\`（可省略参数，默认用当前活跃会话）
3. 多轮澄清目标、范围、非目标与验收标准；写好 \`spec.md\`（勿把对话原文当规格）。
4. 把完整 \`spec.md\` 展示给用户确认。
5. **仅在用户确认后** 调用 \`flowx_submit_brainstorm\`，\`markdown\` 为完整规格正文。

会话标识：
- workflowRunId: \`${workflowRunId}\`
- executionSessionId: \`${executionSessionId}\`
- stage: brainstorm

兼容回传（可选）：若仍写入本目录 \`spec.md\` 或旧版 \`brainstorm.md\`，可执行 \`flowx-local design-submit ${executionSessionId}\`。
`;
  }
  return `# FlowX OpenDesign 本地设计任务

本目录只保存 FlowX 会话凭据与调试副本，**不是**你的 Open Design 工程目录。

推荐流程：
1. 在 Open Design 中打开或创建你自己的项目目录。
2. 通过 FlowX MCP 拉取上下文：
   - \`flowx_get_active_design_session\`
   - \`flowx_get_design_handoff\`（可省略参数，默认用当前活跃会话）
3. 在你的项目里完成设计。
4. 通过 MCP 回传：\`flowx_submit_design\`，提交含完整 \`designArtifact.html\` 的 DesignCompletionReport。

会话标识：
- workflowRunId: \`${workflowRunId}\`
- executionSessionId: \`${executionSessionId}\`
- stage: design

兼容回传（可选）：若仍写入本目录 \`result.json\`，可执行 \`flowx-local design-submit ${executionSessionId}\`。
`;
}

function validateReport(report: DesignCompletionReport) {
  if (
    !report?.idempotencyKey?.trim() ||
    !report.output?.design ||
    !report.output?.demo ||
    !report.output?.designArtifact?.html?.trim()
  ) {
    throw new Error('OpenDesign result.json is incomplete.');
  }
}
