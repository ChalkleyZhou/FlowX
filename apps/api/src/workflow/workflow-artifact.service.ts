import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GeneratePlanOutput } from '../common/types';
import { getWorkflowArtifactsRoot } from './workflow-artifact.paths';
import { renderExecutionReportHtml, type ExecutionReportRepositoryRow } from './workflow-artifact.execution.render';
import { renderPlanHtml } from './workflow-artifact.render';

export type PlanArtifactStatus =
  | 'WAITING_HUMAN_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED';

export interface PlanArtifactMeta {
  summary: string;
  implementationPlan: string[];
  filesToModify: string[];
  newFiles: string[];
  riskPoints: string[];
  status: PlanArtifactStatus;
  confirmedAt?: string | null;
}

interface PlanManifestEntry {
  version: number;
  path: string;
  metaPath: string;
  sha256: string;
  confirmedAt: string | null;
}

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
  plan?: PlanManifestEntry;
  execution?: ExecutionManifestEntry;
}

function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class WorkflowArtifactService {
  getArtifactsRoot(workflowRunId: string): string {
    return getWorkflowArtifactsRoot(workflowRunId);
  }

  async writePlanArtifact(params: {
    workflowRunId: string;
    version: number;
    output: GeneratePlanOutput;
    status: PlanArtifactStatus;
  }): Promise<{ htmlPath: string; metaPath: string; sha256: string }> {
    const { workflowRunId, version, output, status } = params;
    const root = this.getArtifactsRoot(workflowRunId);
    const htmlRel = `plan/v${version}/plan.html`;
    const metaRel = `plan/v${version}/plan.meta.json`;
    const htmlAbs = join(root, htmlRel);
    const metaAbs = join(root, metaRel);

    await mkdir(dirname(htmlAbs), { recursive: true });

    const html = renderPlanHtml(output, {
      workflowRunId,
      version,
      status,
    });
    const meta: PlanArtifactMeta = {
      summary: output.summary,
      implementationPlan: output.implementationPlan,
      filesToModify: output.filesToModify,
      newFiles: output.newFiles,
      riskPoints: output.riskPoints,
      status,
      confirmedAt: null,
    };

    await writeFile(htmlAbs, html, 'utf8');
    await writeFile(metaAbs, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    const sha256 = sha256Hex(html);

    const manifestPath = join(root, 'manifest.json');
    let manifest: ArtifactManifest = {};
    try {
      const existing = await readFile(manifestPath, 'utf8');
      manifest = JSON.parse(existing) as ArtifactManifest;
    } catch {
      // fresh manifest
    }

    manifest.plan = {
      version,
      path: htmlRel,
      metaPath: metaRel,
      sha256,
      confirmedAt: null,
    };

    await mkdir(root, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return { htmlPath: htmlRel, metaPath: metaRel, sha256 };
  }

  async confirmPlanArtifact(workflowRunId: string): Promise<void> {
    const root = this.getArtifactsRoot(workflowRunId);
    const manifestPath = join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ArtifactManifest;
    const plan = manifest.plan;
    if (!plan) {
      throw new Error(`No plan artifact in manifest for workflow ${workflowRunId}`);
    }

    const metaAbs = join(root, plan.metaPath);
    const meta = JSON.parse(await readFile(metaAbs, 'utf8')) as PlanArtifactMeta;
    const confirmedAt = new Date().toISOString();
    meta.status = 'CONFIRMED';
    meta.confirmedAt = confirmedAt;

    await writeFile(metaAbs, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    plan.confirmedAt = confirmedAt;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  async loadPlanMeta(workflowRunId: string): Promise<PlanArtifactMeta | null> {
    const root = this.getArtifactsRoot(workflowRunId);
    const manifestPath = join(root, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ArtifactManifest;
      if (!manifest.plan?.metaPath) {
        return null;
      }
      const metaRaw = await readFile(join(root, manifest.plan.metaPath), 'utf8');
      return JSON.parse(metaRaw) as PlanArtifactMeta;
    } catch {
      return null;
    }
  }

  async readPlanHtml(workflowRunId: string): Promise<string | null> {
    const root = this.getArtifactsRoot(workflowRunId);
    const manifestPath = join(root, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ArtifactManifest;
      if (!manifest.plan?.path) {
        return null;
      }
      return await readFile(join(root, manifest.plan.path), 'utf8');
    } catch {
      return null;
    }
  }

  getPlanArtifactPaths(manifest: ArtifactManifest): { planMetaPath: string | null; planHtmlPath: string | null } {
    return {
      planMetaPath: manifest.plan?.metaPath ?? null,
      planHtmlPath: manifest.plan?.path ?? null,
    };
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
}
