import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), '../../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../prisma/migrations/20260722143000_add_edge_execution_foundation/migration.sql',
  ),
  'utf8',
);

describe('edge execution foundation schema', () => {
  it('defines execution sessions independently from workflow stage attempts', () => {
    expect(schema).toContain('model ExecutionSession {');
    expect(schema).toMatch(/workflowRun\s+WorkflowRun\s+@relation/);
    expect(schema).toMatch(/stageExecution\s+StageExecution\?\s+@relation/);
    expect(schema).toMatch(/traceId\s+String\s+@unique/);
    expect(schema).toMatch(/idempotencyKey\s+String\?\s+@unique/);
    expect(schema).toMatch(/syncEvents\s+SyncEvent\[\]/);
  });

  it('defines sync events, artifacts, and evidence with traceability indexes', () => {
    expect(schema).toContain('model SyncEvent {');
    expect(schema).toContain('model Artifact {');
    expect(schema).toContain('model Evidence {');
    expect(schema).toContain('@@index([traceId, occurredAt])');
    expect(schema).toContain('@@index([workflowRunId, artifactType, createdAt])');
    expect(schema).toContain('@@index([executionSessionId, evidenceType, occurredAt])');
  });

  it('creates the new tables and idempotency constraints in the migration', () => {
    for (const table of ['ExecutionSession', 'SyncEvent', 'Artifact', 'Evidence']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain('CREATE UNIQUE INDEX "ExecutionSession_traceId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "ExecutionSession_idempotencyKey_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "SyncEvent_eventId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "SyncEvent_idempotencyKey_key"');
  });
});
