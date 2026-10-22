import { describe, expect, it } from 'vitest';
import { buildPrototypeWorkflowSnapshot, readPrototypeWorkflowSnapshot } from './workflow-prototype-import';
import { analysis } from '../prototype-imports/prototype-test-fixture';
const record = { id: 'import-1', revision: 3, materialRevision: 1, status: 'CONFIRMED', analysis, confirmedAt: new Date('2026-10-22T00:00:00Z'), confirmedBy: 'user-a' };
describe('导入方案接续工作流', () => {
  it('未确认材料不可跳过构思设计，确认快照保留来源和版本', () => {
    expect(() => buildPrototypeWorkflowSnapshot({ ...record, status: 'WAITING_CONFIRMATION' })).toThrow(/确认/);
    const snapshot = buildPrototypeWorkflowSnapshot(record);
    expect(snapshot).toMatchObject({ source: 'prototype-import', importId: 'import-1', revision: 3, analysis });
    expect(readPrototypeWorkflowSnapshot(snapshot)).toEqual(snapshot);
    expect(readPrototypeWorkflowSnapshot({ ...snapshot, analysis: null })).toBeNull();
  });
});
