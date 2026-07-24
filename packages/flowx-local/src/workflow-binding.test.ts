import { mkdtempSync, rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearWorkflowBinding,
  readWorkflowBinding,
  writeWorkflowBinding,
} from './workflow-binding.js';

const tempHomes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'flowx-binding-'));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length > 0) {
    const home = tempHomes.pop();
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

describe('workflow-binding', () => {
  it('writes current-workflow.json with mode 0o600 and reads it back', async () => {
    const home = makeHome();
    const written = await writeWorkflowBinding(
      {
        workflowRunId: 'wr_1',
        stage: 'brainstorm',
        requirementTitle: 'Demo req',
      },
      home,
    );

    expect(written.workflowRunId).toBe('wr_1');
    expect(written.stage).toBe('brainstorm');
    expect(written.requirementTitle).toBe('Demo req');
    expect(typeof written.boundAt).toBe('string');
    expect(written.boundAt.length).toBeGreaterThan(0);

    const read = await readWorkflowBinding(home);
    expect(read).toEqual(written);
    expect((await stat(join(home, '.flowx', 'current-workflow.json'))).mode & 0o777).toBe(0o600);
  });

  it('updates stage to design while preserving workflowRunId', async () => {
    const home = makeHome();
    await writeWorkflowBinding({ workflowRunId: 'wr_1', stage: 'brainstorm' }, home);
    const updated = await writeWorkflowBinding(
      { workflowRunId: 'wr_1', stage: 'design', requirementTitle: 'Demo req' },
      home,
    );
    expect(updated.stage).toBe('design');
    expect(await readWorkflowBinding(home)).toMatchObject({
      workflowRunId: 'wr_1',
      stage: 'design',
      requirementTitle: 'Demo req',
    });
  });

  it('optionally stores and clears executionSessionId', async () => {
    const home = makeHome();
    const withSession = await writeWorkflowBinding(
      {
        workflowRunId: 'wr_1',
        stage: 'brainstorm',
        executionSessionId: 'session-b1',
      },
      home,
    );
    expect(withSession.executionSessionId).toBe('session-b1');
    expect(await readWorkflowBinding(home)).toMatchObject({
      workflowRunId: 'wr_1',
      executionSessionId: 'session-b1',
    });

    const advanced = await writeWorkflowBinding(
      { workflowRunId: 'wr_1', stage: 'design', requirementTitle: 'Demo' },
      home,
    );
    expect(advanced.executionSessionId).toBeUndefined();
    expect(await readWorkflowBinding(home)).toEqual({
      workflowRunId: 'wr_1',
      stage: 'design',
      boundAt: advanced.boundAt,
      requirementTitle: 'Demo',
    });
  });

  it('clearWorkflowBinding removes the binding file', async () => {
    const home = makeHome();
    await writeWorkflowBinding({ workflowRunId: 'wr_1', stage: 'design' }, home);
    await clearWorkflowBinding(home);
    expect(await readWorkflowBinding(home)).toBeNull();
  });

  it('returns null for missing or invalid binding files', async () => {
    const home = makeHome();
    expect(await readWorkflowBinding(home)).toBeNull();
  });
});
