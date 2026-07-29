import { describe, expect, it } from 'vitest';
import { mapLegacyWorkflowStatus } from './workflow-status-migration';

describe('mapLegacyWorkflowStatus', () => {
  it('maps demo and plan statuses to SPEC_PLAN', () => {
    expect(mapLegacyWorkflowStatus('demo_pending')).toBe('spec_plan_pending');
    expect(mapLegacyWorkflowStatus('demo_waiting_confirmation')).toBe('spec_plan_pending');
    expect(mapLegacyWorkflowStatus('task_split_pending')).toBe('spec_plan_pending');
    expect(mapLegacyWorkflowStatus('task_split_waiting_confirmation')).toBe(
      'spec_plan_waiting_confirmation',
    );
    expect(mapLegacyWorkflowStatus('task_split_confirmed')).toBe('spec_plan_confirmed');
    expect(mapLegacyWorkflowStatus('plan_pending')).toBe('spec_plan_pending');
    expect(mapLegacyWorkflowStatus('plan_waiting_confirmation')).toBe(
      'spec_plan_waiting_confirmation',
    );
    expect(mapLegacyWorkflowStatus('plan_confirmed')).toBe('spec_plan_confirmed');
    expect(mapLegacyWorkflowStatus('execution_pending')).toBe('execution_pending');
  });
});
