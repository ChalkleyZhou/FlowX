import { BadRequestException } from '@nestjs/common';
import { assertPrototypeAnalysis, type PrototypeAnalysis } from '../prototype-imports/prototype-analysis';
export interface PrototypeWorkflowSnapshot {
  source: 'prototype-import';
  importId: string;
  revision: number;
  materialRevision: number;
  confirmedBy: string | null;
  confirmedAt: string;
  analysis: PrototypeAnalysis;
}
export function buildPrototypeWorkflowSnapshot(record: { id: string; revision: number; materialRevision: number; status: string; confirmedBy: string | null; confirmedAt: Date | null; analysis: unknown }): PrototypeWorkflowSnapshot {
  if (record.status !== 'CONFIRMED' || !record.confirmedAt) throw new BadRequestException('原型导入尚未完成，请等待整理完成或重试。');
  return { source: 'prototype-import', importId: record.id, revision: record.revision, materialRevision: record.materialRevision, confirmedBy: record.confirmedBy, confirmedAt: record.confirmedAt.toISOString(), analysis: assertPrototypeAnalysis(record.analysis) };
}
export function readPrototypeWorkflowSnapshot(value: unknown): PrototypeWorkflowSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as PrototypeWorkflowSnapshot;
  if (snapshot.source !== 'prototype-import' || typeof snapshot.importId !== 'string' || !Number.isInteger(snapshot.revision) || !Number.isInteger(snapshot.materialRevision) || typeof snapshot.confirmedAt !== 'string' || (snapshot.confirmedBy !== null && typeof snapshot.confirmedBy !== 'string')) return null;
  try { assertPrototypeAnalysis(snapshot.analysis); return snapshot; } catch { return null; }
}
