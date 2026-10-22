import { BadRequestException } from '@nestjs/common';
import { assertPrototypeAnalysis, type PrototypeAnalysis } from '../prototype-imports/prototype-analysis';
export interface PrototypeWorkflowSnapshot {
  source: 'prototype-import';
  importId: string;
  revision: number;
  materialRevision: number;
  confirmedBy: string;
  confirmedAt: string;
  analysis: PrototypeAnalysis;
}
export function buildPrototypeWorkflowSnapshot(record: { id: string; revision: number; materialRevision: number; status: string; confirmedBy: string | null; confirmedAt: Date | null; analysis: unknown }): PrototypeWorkflowSnapshot {
  if (record.status !== 'CONFIRMED' || !record.confirmedAt || !record.confirmedBy) throw new BadRequestException('请先确认导入方案，再继续研发。');
  return { source: 'prototype-import', importId: record.id, revision: record.revision, materialRevision: record.materialRevision, confirmedBy: record.confirmedBy, confirmedAt: record.confirmedAt.toISOString(), analysis: assertPrototypeAnalysis(record.analysis) };
}
export function readPrototypeWorkflowSnapshot(value: unknown): PrototypeWorkflowSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as PrototypeWorkflowSnapshot;
  if (snapshot.source !== 'prototype-import' || typeof snapshot.importId !== 'string' || !Number.isInteger(snapshot.revision) || !Number.isInteger(snapshot.materialRevision) || typeof snapshot.confirmedAt !== 'string' || typeof snapshot.confirmedBy !== 'string') return null;
  try { assertPrototypeAnalysis(snapshot.analysis); return snapshot; } catch { return null; }
}
