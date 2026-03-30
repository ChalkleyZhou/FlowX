export function formatIssueStatus(status?: string | null) {
  const map: Record<string, string> = {
    OPEN: '待处理',
    IN_PROGRESS: '处理中',
    RESOLVED: '已解决',
    CLOSED: '已关闭',
    WONT_FIX: '不修复',
  };

  return status ? map[status] ?? status : '未设置';
}

export function formatBugStatus(status?: string | null) {
  const map: Record<string, string> = {
    OPEN: '待处理',
    CONFIRMED: '已确认',
    FIXING: '修复中',
    FIXED: '已修复',
    VERIFIED: '已验证',
    CLOSED: '已关闭',
    WONT_FIX: '不修复',
  };

  return status ? map[status] ?? status : '未设置';
}

export function formatPriority(priority?: string | null) {
  const map: Record<string, string> = {
    LOW: '低',
    MEDIUM: '中',
    HIGH: '高',
    URGENT: '紧急',
  };

  return priority ? map[priority] ?? priority : '未设置';
}

export function formatPriorityLabel(priority?: string | null) {
  return `优先级：${formatPriority(priority)}`;
}

export function formatSeverity(severity?: string | null) {
  const map: Record<string, string> = {
    LOW: '低',
    MEDIUM: '中',
    HIGH: '高',
    CRITICAL: '严重',
  };

  return severity ? map[severity] ?? severity : '未设置';
}

export function formatSeverityLabel(severity?: string | null) {
  return `严重级别：${formatSeverity(severity)}`;
}

export function formatReviewFindingType(type?: string | null) {
  const map: Record<string, string> = {
    ISSUE: '问题项',
    BUG: '缺陷',
    MISSING_TEST: '缺少测试',
    SUGGESTION: '建议',
  };

  return type ? map[type] ?? type : '未设置';
}

export function formatReviewFindingStatus(status?: string | null) {
  const map: Record<string, string> = {
    OPEN: '待处理',
    ACCEPTED: '已接受',
    DISMISSED: '已忽略',
    CONVERTED_TO_ISSUE: '已转问题项',
    CONVERTED_TO_BUG: '已转缺陷',
  };

  return status ? map[status] ?? status : '未设置';
}

export function formatRepositorySyncStatus(status?: string | null) {
  const map: Record<string, string> = {
    PENDING: '待同步',
    SYNCING: '同步中',
    READY: '已就绪',
    ERROR: '同步失败',
  };

  return status ? map[status] ?? status : '未设置';
}

export function formatWorkflowRepositoryStatus(status?: string | null) {
  const map: Record<string, string> = {
    PENDING: '待准备',
    PREPARING: '准备中',
    READY: '已就绪',
    ERROR: '准备失败',
  };

  return status ? map[status] ?? status : '未设置';
}
