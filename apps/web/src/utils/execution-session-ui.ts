import type { ExecutionSessionDetail } from '../types';

type Tone = 'default' | 'success' | 'warning' | 'destructive';

export function executionStatus(session: ExecutionSessionDetail): { label: string; description: string; tone: Tone } {
  if (session.status === 'COMPLETED') return { label: '已完成', description: '完成结果已回传平台。', tone: 'success' };
  if (session.status === 'CANCELLED') return { label: '已取消', description: '本地执行已确认停止。', tone: 'default' };
  if (session.status === 'FAILED') return { label: '执行失败', description: session.errorMessage || '本次执行失败，可检查原因后重新交接。', tone: 'destructive' };
  if (session.cancelRequestedAt) return { label: '等待本地确认停止', description: '平台已阻止提交完成，等待本地 Agent 停止任务并回执。', tone: 'warning' };
  if (session.status === 'BLOCKED') return { label: '等待处理', description: session.blockedReason || '本地 Agent 报告阻塞。', tone: 'warning' };
  if (session.health === 'STALE') return { label: '超过 5 分钟无回报', description: '先在本地确认任务是否还在执行。', tone: 'warning' };
  if (session.health === 'UNKNOWN') return { label: '尚无本地回报', description: '尚未收到检查点，无法判断 Agent 当前情况。', tone: 'default' };
  if (session.status === 'COMPLETING') return { label: '正在提交结果', description: '等待平台确认完成报告。', tone: 'default' };
  if (session.status === 'CREATED' || session.status === 'CLAIMED') return { label: '等待本地执行', description: '会话已创建，等待本地 Agent 回报。', tone: 'default' };
  return { label: '最近有回报', description: '最近收到本地检查点；实际执行情况以本地 Agent 为准。', tone: 'success' };
}

export function formatExecutionTime(value?: string | null): string {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString('zh-CN');
}
