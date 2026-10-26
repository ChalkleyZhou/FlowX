import { BadRequestException } from '@nestjs/common';
import type { PrototypeManifest } from '../prototype-imports/prototype-archive';
import { readPrototypeWorkflowSnapshot, type PrototypeWorkflowSnapshot } from '../workflow/workflow-prototype-import';

export interface ChangePrototype {
  archiveId: string;
  name: string;
  sha256: string;
  aiProvider: 'codex' | 'cursor';
  manifest: PrototypeManifest;
  snapshot?: PrototypeWorkflowSnapshot;
}

export function readChangePrototype(value: unknown): ChangePrototype | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('原型变更材料记录无效。');
  const record = value as ChangePrototype;
  if (typeof record.archiveId !== 'string' || typeof record.name !== 'string' || typeof record.sha256 !== 'string' || !['codex', 'cursor'].includes(record.aiProvider) || !Array.isArray(record.manifest?.files)) throw new BadRequestException('原型变更材料记录无效。');
  if (record.snapshot && !readPrototypeWorkflowSnapshot(record.snapshot)) throw new BadRequestException('原型变更分析记录无效。');
  return record;
}
