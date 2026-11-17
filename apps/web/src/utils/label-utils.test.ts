import { describe, expect, it } from 'vitest';
import { formatWorkItemStatus } from './label-utils';

describe('formatWorkItemStatus', () => {
  it('将常见工作项状态显示为中文', () => {
    expect(formatWorkItemStatus('ACTIVE')).toBe('进行中');
    expect(formatWorkItemStatus('OPEN')).toBe('待处理');
    expect(formatWorkItemStatus('IN_PROGRESS')).toBe('处理中');
    expect(formatWorkItemStatus('FIXING')).toBe('修复中');
    expect(formatWorkItemStatus('CLOSED')).toBe('已关闭');
  });

  it('对未知状态保留原值，避免丢失后端新增状态', () => {
    expect(formatWorkItemStatus('CUSTOM_STATUS')).toBe('CUSTOM_STATUS');
    expect(formatWorkItemStatus(null)).toBe('未设置');
  });
});
