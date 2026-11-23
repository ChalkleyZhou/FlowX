import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), '../../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(resolve(process.cwd(), '../../prisma/migrations/20261112090000_work_item_core/migration.sql'), 'utf8');

describe('WorkItem core schema', () => {
  it('defines a single version work-item root and execution hierarchy', () => {
    expect(schema).toContain('model WorkItem {');
    expect(schema).not.toContain('model Requirement {');
    expect(schema).not.toContain('model Issue {');
    expect(schema).not.toContain('requirementId         String');
    expect(schema).toContain('kind                    String');
    expect(schema).toContain('displayCode             String?');
    expect(schema).toContain('model WorkItemSequence {');
    expect(schema).toContain('acceptanceCriteria      String');
    expect(schema).toContain('resolution              String?');
    expect(schema).toContain('sourceProvider          String?');
    expect(schema).toContain('affectedVersion         String?');
    expect(schema).toContain('@@unique([sourceProvider, sourceId])');
    expect(schema).toContain('model WorkItemMember {');
    expect(schema).toContain('members                 WorkItemMember[]');
    expect(schema).toContain('@@unique([workItemId, userId, role])');
    expect(schema).toContain('model ExecutionPlan {');
    expect(schema).toContain('model ExecutionItem {');
    expect(schema).toContain('completionEvidence Json?');
    expect(schema).toContain('blockedReason     String?');
    expect(schema).toContain('cancelReason      String?');
    expect(schema).toMatch(/workItemId\s+String/);
    expect(schema).toMatch(/executionItemId\s+String\?/);
    expect(schema).toContain('@@index([projectId, versionId, updatedAt, id])');
  });

  it('creates the root, details, plan and item tables with stable indexes', () => {
    for (const table of ['WorkItem', 'ExecutionPlan', 'ExecutionItem']) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "WorkItem_projectId_versionId_updatedAt_id_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionItem_claimKey_key"');
    expect(migration).toContain('work-item-migration-plan-');
    const displayCodeMigration = readFileSync(resolve(process.cwd(), '../../prisma/migrations/20261116150000_add_work_item_display_code/migration.sql'), 'utf8');
    expect(displayCodeMigration).toContain('CREATE TABLE IF NOT EXISTS "WorkItemSequence"');
    expect(displayCodeMigration).toContain('ROW_NUMBER() OVER');
    expect(displayCodeMigration).toContain('REQ');
    expect(migration).toContain('work-item-migration-execution-');
    expect(migration).toContain('UPDATE "WorkflowRun" SET "workItemId" = "requirementId"');
    expect(migration).toContain('RENAME TO "TestDesignWorkItem"');
    expect(migration).toContain('RENAME TO "TestRequestWorkItem"');
    const importMigration = readFileSync(resolve(process.cwd(), '../../prisma/migrations/20261123130000_add_work_item_import_fields/migration.sql'), 'utf8');
    expect(importMigration).toContain('WorkItem_sourceProvider_sourceId_key');
    const memberMigration = readFileSync(resolve(process.cwd(), '../../prisma/migrations/20261123133000_add_work_item_members/migration.sql'), 'utf8');
    expect(memberMigration).toContain('CREATE TABLE "WorkItemMember"');
    expect(memberMigration).toContain('WorkItemMember_workItemId_userId_role_key');
  });
});
