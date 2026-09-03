import { BadRequestException } from '@nestjs/common';

export const TEST_REQUEST_STATUSES = [
  'DRAFT',
  'READY',
  'IN_TEST',
  'PASSED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const;

export enum TestRequestStatus {
  DRAFT = 'DRAFT',
  READY = 'READY',
  IN_TEST = 'IN_TEST',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  BLOCKED = 'BLOCKED',
  CANCELLED = 'CANCELLED',
}

const transitions: Record<TestRequestStatus, TestRequestStatus[]> = {
  [TestRequestStatus.DRAFT]: [TestRequestStatus.READY, TestRequestStatus.CANCELLED],
  [TestRequestStatus.READY]: [TestRequestStatus.IN_TEST, TestRequestStatus.CANCELLED],
  [TestRequestStatus.IN_TEST]: [
    TestRequestStatus.PASSED,
    TestRequestStatus.FAILED,
    TestRequestStatus.BLOCKED,
    TestRequestStatus.CANCELLED,
  ],
  [TestRequestStatus.PASSED]: [TestRequestStatus.IN_TEST],
  [TestRequestStatus.FAILED]: [TestRequestStatus.IN_TEST],
  [TestRequestStatus.BLOCKED]: [TestRequestStatus.IN_TEST, TestRequestStatus.CANCELLED],
  [TestRequestStatus.CANCELLED]: [],
};

export function assertTestRequestTransition(from: TestRequestStatus, to: TestRequestStatus) {
  if (!transitions[from].includes(to)) {
    throw new BadRequestException(`Illegal test request transition: ${from} -> ${to}`);
  }
}
