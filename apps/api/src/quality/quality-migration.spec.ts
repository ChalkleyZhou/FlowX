import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('质量执行迁移保留旧人工和冒烟轮次、快照、结果与租约，并设置兼容默认值', () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowx-quality-migration-'));
  const databasePath = join(directory, 'legacy.db');
  const url = `file:${databasePath}`;
  const schema = readFileSync(resolve('../../prisma/schema.prisma'), 'utf8');
  // 从当前 schema 只移除本次新增项，避免测试在未来提交后依赖变化的 HEAD。
  const removedFields: Record<string, string[]> = {
    TestCaseDefinition: ['targetKeys'], TestCaseSnapshot: ['targetKeys'],
    TestDesign: ['caseSelection', 'retrievalSummary'], TestRun: ['executionMode', 'revision'],
  };
  const baseline = schema
    .replace(/^model (?:QualityProgressEvent|QualityTestReport) \{[\s\S]*?^\}\n/gm, '')
    .replace(/^.*\b(?:QualityProgressEvent|QualityTestReport)\[\].*\n/gm, '')
    .replace(/^model (\w+) \{[\s\S]*?^\}/gm, (block: string, model: string) => {
      const fields = removedFields[model];
      return fields ? block.replace(new RegExp(`^  (?:${fields.join('|')})\\s+.*\\n`, 'gm'), '') : block;
    });
  const schemaPath = join(directory, 'baseline.prisma');
  const sqlPath = join(directory, 'baseline.sql');
  writeFileSync(schemaPath, baseline);
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  try {
    const sql = execFileSync(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } });
    writeFileSync(sqlPath, sql);
    const output = execFileSync('python3', ['-c', String.raw`
import json, sqlite3, sys
from pathlib import Path
connection = sqlite3.connect(sys.argv[1])
connection.row_factory = sqlite3.Row
connection.executescript(Path(sys.argv[2]).read_text())
connection.execute('PRAGMA foreign_keys=ON')

def insert(table, **values):
    columns = {row['name'] for row in connection.execute('PRAGMA table_info("' + table + '")')}
    if 'updatedAt' in columns:
        values['updatedAt'] = '2026-10-01 00:00:00'
    connection.execute('INSERT INTO "' + table + '" (' + ','.join('"' + key + '"' for key in values) + ') VALUES (' + ','.join('?' for key in values) + ')', list(values.values()))

insert('Organization', id='org', provider='test', providerOrganizationId='quality-migration', name='历史组织')
insert('Workspace', id='workspace', organizationId='org', name='历史空间')
insert('Project', id='project', workspaceId='workspace', name='历史项目')
insert('ProjectVersion', id='version', projectId='project', name='v1')
insert('TestCaseLibrary', id='library', workspaceId='workspace', projectId='project', scope='PROJECT', name='历史用例库')
insert('TestCaseDefinition', id='definition', libraryId='library', title='历史定义', steps='["执行"]', expected='原预期')
insert('TestDesign', id='design', workspaceId='workspace', projectId='project', projectVersionId='version', sourceFingerprint='legacy-design', sourceSummary='{}')
insert('TestRequest', id='request', workspaceId='workspace', projectId='project', projectVersionId='version', testDesignId='design', title='历史提测', traceId='legacy-trace')
insert('TestPlan', id='plan', testRequestId='request', testDesignId='design')
for run_id, run_type, kind, result in [('manual', 'INITIAL', 'FUNCTIONAL', 'FAILED'), ('smoke', 'LOCAL_SMOKE', 'SMOKE', 'PASSED')]:
    insert('TestCaseSnapshot', id=run_id + '-snapshot', testPlanId='plan', sourceDefinitionId='definition' if kind == 'FUNCTIONAL' else None, sourceVersion=1 if kind == 'FUNCTIONAL' else None, title=run_id + '历史快照', priority='P1', steps='["历史步骤"]', expected='原预期', kind=kind)
    insert('TestRun', id=run_id, testPlanId='plan', name=run_id + '历史轮次', runType=run_type, status=result, sourceFingerprint=run_id + '-fingerprint', reportRevision=3)
    insert('TestRunTarget', id=run_id + '-target', testRunId=run_id, key='web', name='网页端', expectedRevisions='[{"workflowRepositoryId":"legacy-repo","branch":"main","headSha":"old"}]', status=result)
    insert('TestRunCase', id=run_id + '-case', testRunId=run_id, snapshotId=run_id + '-snapshot', targetId=run_id + '-target')
    insert('TestResult', id=run_id + '-result', testRunCaseId=run_id + '-case', result=result, actualResult='历史实际结果', evidence='{"artifactIds":["legacy-evidence"]}')
insert('ExecutionSession', id='session', testRunId='smoke', organizationId='org', workspaceId='workspace', projectId='project', executorType='LOCAL', sourceTool='flowx-local', protocolVersion='legacy', traceId='session-trace')
insert('TestExecution', id='execution', testRunId='smoke', targetId='smoke-target', executionSessionId='session', claimedCaseIds='["smoke-case"]', sourceFingerprint='smoke-fingerprint', leaseExpiresAt='2026-12-01 00:00:00')
insert('TestRunCaseLease', testRunCaseId='smoke-case', testExecutionId='execution', leaseExpiresAt='2026-12-01 00:00:00')
insert('TestExecutionCaseResult', id='execution-result', testExecutionId='execution', testRunCaseId='smoke-case', result='PASSED', artifactIds='["legacy-evidence"]')
connection.commit()
assert not connection.execute('PRAGMA foreign_key_check').fetchall()
tables = ['TestCaseDefinition', 'TestDesign', 'TestRequest', 'TestPlan', 'TestCaseSnapshot', 'TestRun', 'TestRunTarget', 'TestRunCase', 'TestResult', 'ExecutionSession', 'TestExecution', 'TestRunCaseLease', 'TestExecutionCaseResult']
before = {table: [dict(row) for row in connection.execute('SELECT * FROM "' + table + '" ORDER BY rowid')] for table in tables}
connection.executescript(Path(sys.argv[3]).read_text())
after = {table: [{key: row[key] for key in before[table][0]} for row in connection.execute('SELECT * FROM "' + table + '" ORDER BY rowid')] for table in tables}
print(json.dumps({
    'before': before, 'after': after,
    'runs': [dict(row) for row in connection.execute('SELECT id, executionMode, revision, reportRevision FROM TestRun ORDER BY id')],
    'nullable': {
        'definition': connection.execute('SELECT targetKeys FROM TestCaseDefinition').fetchone()[0],
        'snapshot': [row[0] for row in connection.execute('SELECT targetKeys FROM TestCaseSnapshot')],
        'design': dict(connection.execute('SELECT caseSelection, retrievalSummary FROM TestDesign').fetchone()),
    },
    'newTables': {table: connection.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0] for table in ['QualityProgressEvent', 'QualityTestReport']},
    'foreignKeysEnabled': connection.execute('PRAGMA foreign_keys').fetchone()[0],
    'foreignKeyErrors': [list(row) for row in connection.execute('PRAGMA foreign_key_check')],
}, ensure_ascii=False))
connection.close()
`, databasePath, sqlPath, resolve('../../prisma/migrations/20261104000000_quality_execution/migration.sql')], { encoding: 'utf8' });
    const migrated = JSON.parse(output);
    expect(migrated.after).toEqual(migrated.before);
    expect(migrated.runs).toEqual([
      { id: 'manual', executionMode: 'MANUAL', revision: 0, reportRevision: 3 },
      { id: 'smoke', executionMode: 'MANUAL', revision: 0, reportRevision: 3 },
    ]);
    expect(migrated.nullable).toEqual({ definition: null, snapshot: [null, null], design: { caseSelection: null, retrievalSummary: null } });
    expect(migrated.newTables).toEqual({ QualityProgressEvent: 0, QualityTestReport: 0 });
    expect(migrated.foreignKeysEnabled).toBe(1);
    expect(migrated.foreignKeyErrors).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
