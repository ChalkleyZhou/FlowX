import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainstormCompletionReport, DesignCompletionReport } from '@flowx-ai/protocol';
import { writeActiveDesignSession } from '../active-design-session.js';
import type { LocalConfig } from '../config.js';
import { assertDesignSurfacesPresent, loadDesignSurfacesFromDir } from '../design-surfaces.js';
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
        ? input.handoff.contextPackage.outputContract?.resultFileName ?? 'prd.md'
        : input.handoff.contextPackage.outputContract.resultFileName;
    const resultPath = join(workspacePath, resultFileName);
    await mkdir(workspacePath, { recursive: true });
    await writeFile(contextPath, `${JSON.stringify(input.handoff.contextPackage, null, 2)}\n`, 'utf8');
    if (stage === 'brainstorm') {
      await writeInitialMarkdown(resultPath);
    } else {
      await mkdir(join(workspacePath, 'design', 'Web端'), { recursive: true });
      await writeInitialDesignMarkdown(join(workspacePath, 'design.md'));
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
        throw new Error('OpenDesign prd.md (or legacy spec.md / brainstorm.md) is empty.');
      }
      return this.edgeClient.submitBrainstorm({
        apiBaseUrl: session.apiBaseUrl,
        accessToken: session.accessToken,
        executionSessionId,
        report,
      });
    }
    const report = JSON.parse(await readFile(session.resultPath, 'utf8')) as DesignCompletionReport;
    report.markdown = await readDesignMarkdown(dirname(session.resultPath));
    await validateReport(report, dirname(session.resultPath));
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
    markdown: '# 设计文档\n\n请完成并确认 design.md 后，再提交其完整正文。',
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
      surfaces: [
        {
          id: 'Web端',
          pages: [{ id: 'index', title: '设计稿', html: '<!doctype html><html><body></body></html>' }],
        },
      ],
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
        '# 产品需求（PRD）',
        '',
        '请按用户级 Skill `flowx-product-prd`：先与用户头脑风暴澄清产品需求，再写本 `prd.md`，',
        '展示全文供确认，仅在用户确认后调用 `flowx_submit_brainstorm`。',
        '',
        '读者：产品经理、设计师。勿写技术实现细节。',
        '',
        '## 背景与问题',
        '',
        '## 目标用户',
        '',
        '## 目标 / 非目标',
        '',
        '## 用户故事与核心场景',
        '',
        '## 产品规则与边界情况',
        '',
        '## 验收标准',
        '',
        '## 仍开放的产品问题',
        '',
      ].join('\n'),
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

async function writeInitialDesignMarkdown(designMarkdownPath: string) {
  try {
    await writeFile(
      designMarkdownPath,
      [
        '# 设计文档',
        '',
        '请根据 FlowX 上下文完成本设计文档；先向用户展示全文并确认，再将完整正文作为 `markdown` 调用 `flowx_submit_design`。',
        '',
        '## 概述',
        '',
        '## 页面与交互',
        '',
        '## 多端说明',
        '',
        '## 验收要点',
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
  const candidates = [
    resultPath,
    join(root, 'prd.md'),
    join(root, 'spec.md'),
    join(root, 'brainstorm.md'),
  ];
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

async function readDesignMarkdown(sessionDir: string): Promise<string> {
  try {
    return await readFile(join(sessionDir, 'design.md'), 'utf8');
  } catch {
    return '';
  }
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

推荐流程（与用户级 Skill \`flowx-product-prd\` 一致；请先运行 \`flowx-local setup\`）：
1. 在 Open Design 中打开或创建你自己的项目目录。
2. 通过 FlowX MCP 拉取上下文：
   - \`flowx_get_active_design_session\`
   - \`flowx_get_brainstorm_handoff\`（可省略参数，默认用当前活跃会话）
3. **先头脑风暴**澄清目标用户、问题、场景、边界与验收标准；写好 \`prd.md\`（勿把对话原文当 PRD）。
4. 读者为产品经理/设计师；**禁止**在 PRD 正文中写 API、框架、数据库或实现细节。
5. 把完整 \`prd.md\` 展示给用户确认。
6. **仅在用户确认后** 调用 \`flowx_submit_brainstorm\`，\`markdown\` 为完整 PRD 正文。

会话标识：
- workflowRunId: \`${workflowRunId}\`
- executionSessionId: \`${executionSessionId}\`
- stage: brainstorm

兼容回传（可选）：若仍写入本目录 \`prd.md\`（兼容 \`spec.md\` / \`brainstorm.md\`），可执行 \`flowx-local design-submit ${executionSessionId}\`。
`;
  }
  return `# FlowX OpenDesign 本地设计任务

本目录只保存 FlowX 会话凭据与调试副本，**不是**你的 Open Design 工程目录。

推荐流程：
1. 在 Open Design 中打开或创建你自己的项目目录。
2. 通过 FlowX MCP 拉取上下文：
   - \`flowx_get_active_design_session\`
   - \`flowx_get_design_handoff\`（可省略参数，默认用当前活跃会话）
3. 在项目里完成 \`design.md\`：写清概述、页面与交互、多端说明和验收要点，并向用户展示全文确认。
4. 按端组织 HTML 设计稿（可复制到本会话 \`design/\` 或直接在回传 JSON 中填写）：
   - 推荐目录名：\`Web端\` / \`移动端\` / \`管理后台\`（按需，有啥交啥）
   - 每端可有多个 \`.html\` 文件
5. 确认 \`design.md\` 后通过 MCP 回传：\`flowx_submit_design({ markdown, output })\`，其中 \`markdown\` 为完整 \`design.md\` 正文，\`output.surfaces\` 仍为按端多页 HTML（可一次只交一端）。

会话标识：
- workflowRunId: \`${workflowRunId}\`
- executionSessionId: \`${executionSessionId}\`
- stage: design

兼容回传（可选）：若仍写入本目录 \`design.md\`、\`result.json\` 或 \`design/<端>/*.html\`，可执行 \`flowx-local design-submit ${executionSessionId}\`。
`;
}

async function validateReport(report: DesignCompletionReport, sessionDir?: string) {
  if (
    !report?.idempotencyKey?.trim() ||
    !report.markdown?.trim() ||
    !report.output?.design ||
    !report.output?.demo
  ) {
    throw new Error('OpenDesign result.json is incomplete.');
  }
  let surfaces = report.output.surfaces;
  if ((!surfaces || surfaces.length === 0) && sessionDir) {
    surfaces = await loadDesignSurfacesFromDir(sessionDir);
    report.output.surfaces = surfaces;
  }
  assertDesignSurfacesPresent(surfaces);
}
