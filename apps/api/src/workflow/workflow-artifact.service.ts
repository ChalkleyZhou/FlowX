import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { getWorkflowArtifactsRoot } from './workflow-artifact.paths';
import { renderExecutionReportHtml, type ExecutionReportRepositoryRow } from './workflow-artifact.execution.render';

export interface ExecutionArtifactMeta {
  executor: 'LOCAL' | 'CLOUD';
  status: 'COMPLETED';
  completedAt: string;
  patchSummary: string;
  changedFiles: string[];
  pushed: boolean;
  repositories: Array<{
    workflowRepositoryId: string;
    name: string;
    workingBranch: string;
    headSha: string;
    changedFiles: string[];
    verified: boolean;
  }>;
}

interface ExecutionManifestEntry {
  version: number;
  path: string;
  metaPath: string;
  sha256: string;
  executor: string;
  completedAt: string;
}

interface ArtifactManifest {
  execution?: ExecutionManifestEntry;
}

function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class WorkflowArtifactService {
  private readonly logger = new Logger(WorkflowArtifactService.name);

  constructor(@Optional() private readonly artifactsService?: ArtifactsService) {}

  getArtifactsRoot(workflowRunId: string): string {
    return getWorkflowArtifactsRoot(workflowRunId);
  }

  async readManifest(workflowRunId: string): Promise<ArtifactManifest> {
    const manifestPath = join(this.getArtifactsRoot(workflowRunId), 'manifest.json');
    try {
      return JSON.parse(await readFile(manifestPath, 'utf8')) as ArtifactManifest;
    } catch {
      return {};
    }
  }

  async writeExecutionArtifact(params: {
    workflowRunId: string;
    version: number;
    executor: 'LOCAL' | 'CLOUD';
    patchSummary: string;
    changedFiles: string[];
    meta: ExecutionArtifactMeta;
    repositoryRows: ExecutionReportRepositoryRow[];
    pushed: boolean;
  }): Promise<{ htmlPath: string; metaPath: string; sha256: string }> {
    const { workflowRunId, version } = params;
    const root = this.getArtifactsRoot(workflowRunId);
    const htmlRel = `execution/v${version}/report.html`;
    const metaRel = `execution/v${version}/execution.meta.json`;
    const htmlAbs = join(root, htmlRel);
    const metaAbs = join(root, metaRel);

    await mkdir(dirname(htmlAbs), { recursive: true });

    const html = renderExecutionReportHtml({
      workflowRunId,
      version,
      executor: params.executor,
      patchSummary: params.patchSummary,
      changedFiles: params.changedFiles,
      repositories: params.repositoryRows,
      pushed: params.pushed,
    });

    await writeFile(htmlAbs, html, 'utf8');
    await writeFile(metaAbs, `${JSON.stringify(params.meta, null, 2)}\n`, 'utf8');

    const sha256 = sha256Hex(html);
    const completedAt = params.meta.completedAt;
    const manifest = await this.readManifest(workflowRunId);
    manifest.execution = {
      version,
      path: htmlRel,
      metaPath: metaRel,
      sha256,
      executor: params.executor,
      completedAt,
    };
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await this.registerArtifact({
      workflowRunId,
      artifactType: 'EXECUTION_REPORT',
      name: `执行报告 v${version}`,
      version: String(version),
      storageProvider: 'local',
      storageKey: `workflow/${workflowRunId}/artifacts/${htmlRel}`,
      mimeType: 'text/html; charset=utf-8',
      byteSize: Buffer.byteLength(html, 'utf8'),
      sha256,
      status: 'AVAILABLE',
      metadata: { metaPath: metaRel, executor: params.executor, completedAt },
    });

    return { htmlPath: htmlRel, metaPath: metaRel, sha256 };
  }

  async readExecutionHtml(workflowRunId: string): Promise<string | null> {
    const manifest = await this.readManifest(workflowRunId);
    if (!manifest.execution?.path) {
      return null;
    }
    try {
      return await readFile(join(this.getArtifactsRoot(workflowRunId), manifest.execution.path), 'utf8');
    } catch {
      return null;
    }
  }

  private async registerArtifact(
    input: Parameters<ArtifactsService['registerWorkflowArtifact']>[0],
  ): Promise<void> {
    if (!this.artifactsService) {
      return;
    }
    try {
      await this.artifactsService.registerWorkflowArtifact(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Artifact file was written but metadata registration failed for workflow ${input.workflowRunId}: ${message}`,
      );
    }
  }
}
