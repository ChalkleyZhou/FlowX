import { describe, expect, it } from 'vitest';
import { resolveLocalPosition, summarizePriorOutputs } from './workflow-position';

describe('resolveLocalPosition', () => {
  it.each([
    ['BRAINSTORM_PENDING', 'generate', 'brainstorm', ['prd.md']],
    ['design_pending', 'generate', 'design', ['design.md']],
    ['SPEC_PLAN_PENDING', 'generate', 'spec-plan', ['spec.md', 'plan.md', 'spec-plan.json']],
    ['EXECUTION_RUNNING', 'generate', 'execution', []],
    ['SPEC_PLAN_CONFIRMED', 'generate', 'execution', []],
  ] as const)('maps %s to a local generation stage', (status, action, stage, files) => {
    expect(resolveLocalPosition(status)).toMatchObject({
      localAction: action,
      stage,
      outputContract: { files },
    });
  });

  it.each([
    'DESIGN_WAITING_CONFIRMATION',
    'SPEC_PLAN_WAITING_CONFIRMATION',
    'REVIEW_PENDING',
    'HUMAN_REVIEW_PENDING',
  ])('asks the user to confirm %s on the web', (status) => {
    const position = resolveLocalPosition(status);
    expect(position.localAction).toBe('wait_for_confirmation');
    expect(position.outputContract).toBeNull();
    expect(position.message.length).toBeGreaterThan(0);
  });

  it.each(['DONE', 'FAILED', 'CREATED', 'REPOSITORY_GROUNDING_PENDING'])(
    'does not open a local stage for %s',
    (status) => {
      expect(resolveLocalPosition(status).localAction).toBe('none');
    },
  );
});

describe('summarizePriorOutputs', () => {
  it.each(['REJECTED', 'FAILED', 'PENDING', 'RUNNING', 'WAITING_CONFIRMATION'])(
    'does not fall back to a confirmed output when the latest attempt is %s',
    (status) => {
      expect(summarizePriorOutputs([
        { id: 'old', stage: 'DESIGN', status: 'COMPLETED', attempt: 1, output: { markdown: '旧确认稿' } },
        { id: 'latest', stage: 'DESIGN', status, attempt: 2, output: { markdown: '新稿' } },
      ])).toEqual([]);
    },
  );

  it('keeps only the latest confirmed stage output and a short summary', () => {
    const outputs = summarizePriorOutputs([
      {
        id: 'brainstorm-old',
        stage: 'BRAINSTORM',
        status: 'COMPLETED',
        attempt: 1,
        output: { markdown: '# Old\n\nreplaced' },
      },
      {
        id: 'brainstorm-new',
        stage: 'BRAINSTORM',
        status: 'COMPLETED',
        attempt: 2,
        output: { markdown: '# Export PRD\n\n' + 'x'.repeat(300) },
      },
      {
        id: 'design-1',
        stage: 'DESIGN',
        status: 'WAITING_CONFIRMATION',
        attempt: 1,
        output: { markdown: '# Export design' },
      },
      {
        id: 'spec-pending',
        stage: 'SPEC_PLAN',
        status: 'PENDING',
        attempt: 1,
        output: { spec: { goal: 'not submitted' } },
      },
    ]);

    expect(outputs).toEqual([
      {
        stage: 'brainstorm',
        stageExecutionId: 'brainstorm-new',
        status: 'COMPLETED',
        files: ['prd.md'],
        summary: '# Export PRD',
      },
    ]);
  });
});
