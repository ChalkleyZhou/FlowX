import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { DesignCompletionReport } from 'flowx-protocol';
import type { LocalConfig } from '../config.js';
import { EdgeClient, type RedeemedOpenDesignLaunch } from '../edge-client.js';
import type { ToolAdapter } from './tool-adapter.js';

type StoredDesignSession = {
  executionSessionId: string;
  apiBaseUrl: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  resultPath: string;
};

export type OpenDesignLaunchResult = {
  ok: true;
  executionSessionId: string;
  workspacePath: string;
  contextPath: string;
  resultPath: string;
  opened: boolean;
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
  ) {}

  async launch(input: RedeemedOpenDesignLaunch): Promise<OpenDesignLaunchResult> {
    const sessionId = input.handoff.executionSessionId;
    const workspacePath = this.sessionRoot(sessionId);
    const contextPath = join(workspacePath, 'context.json');
    const resultPath = join(workspacePath, input.handoff.contextPackage.outputContract.resultFileName);
    await mkdir(workspacePath, { recursive: true });
    await writeFile(contextPath, `${JSON.stringify(input.handoff.contextPackage, null, 2)}\n`, 'utf8');
    await writeInitialResult(resultPath, input.handoff.executionSessionId);
    await writeFile(
      join(workspacePath, 'README.md'),
      buildInstructions(input.handoff.executionSessionId, resultPath),
      'utf8',
    );
    await writeFile(
      join(workspacePath, 'session.json'),
      `${JSON.stringify(
        {
          executionSessionId: sessionId,
          apiBaseUrl: input.apiBaseUrl,
          accessToken: input.accessToken,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          resultPath,
        } satisfies StoredDesignSession,
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    return {
      ok: true,
      executionSessionId: sessionId,
      workspacePath,
      contextPath,
      resultPath,
      opened: this.openWorkspace(workspacePath),
    };
  }

  async submit(executionSessionId: string) {
    const session = await this.loadSession(executionSessionId);
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
    return JSON.parse(
      await readFile(join(this.sessionRoot(executionSessionId), 'session.json'), 'utf8'),
    ) as StoredDesignSession;
  }

  private sessionRoot(executionSessionId: string) {
    return join(
      this.homeDir,
      '.flowx',
      'design-sessions',
      executionSessionId.replace(/[^a-zA-Z0-9._-]/g, '-'),
    );
  }

  private openWorkspace(workspacePath: string) {
    const command = this.config.openDesignCommand;
    try {
      const child = command
        ? spawn(command, [workspacePath], { detached: true, stdio: 'ignore' })
        : platform() === 'darwin'
          ? spawn('open', [workspacePath], { detached: true, stdio: 'ignore' })
          : null;
      child?.unref();
      return Boolean(child);
    } catch {
      return false;
    }
  }
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

function isAlreadyExists(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}

function buildInstructions(executionSessionId: string, resultPath: string) {
  return `# FlowX OpenDesign 本地设计任务

1. 阅读 \`context.json\` 中的需求、验收标准和仓库上下文。
2. 在 OpenDesign 中完成设计。
3. 将设计结果写入 \`${resultPath}\`，保留 design、demo、designArtifact 三个顶层字段。
4. designArtifact.html 必须是完整、自包含的 HTML 文档。
5. 回传命令：\`flowx-local design-submit ${executionSessionId}\`。
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
