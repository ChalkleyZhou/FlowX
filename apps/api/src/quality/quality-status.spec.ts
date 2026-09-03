import { describe, expect, it } from 'vitest';
import {
  TEST_REQUEST_STATUSES,
  TestRequestStatus,
  assertTestRequestTransition,
} from './quality-status';

describe('quality status', () => {
  it('does not model a rejected state in the AI-driven test request lifecycle', () => {
    expect(TEST_REQUEST_STATUSES).not.toContain('REJECTED');
  });

  it('allows a ready request to enter testing', () => {
    expect(() =>
      assertTestRequestTransition(TestRequestStatus.READY, TestRequestStatus.IN_TEST),
    ).not.toThrow();
  });

  it('does not allow a draft request to bypass scope readiness checks', () => {
    expect(() =>
      assertTestRequestTransition(TestRequestStatus.DRAFT, TestRequestStatus.IN_TEST),
    ).toThrow('Illegal test request transition');
  });
});
