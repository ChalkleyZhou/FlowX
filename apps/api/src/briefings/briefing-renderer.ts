import type { BriefingAiSummary } from './briefing-ai-summarizer.service';
import {
  collectDailyCommits,
  formatCommitBullet,
  summarizeDailyCommits,
} from './briefing-commits';
import type { BriefingEventType, NormalizedBriefingEvent } from './briefing-events';

export interface BriefingAggregate {
  overview: {
    projectCount: number;
    eventCount: number;
    mergeRequestCount: number;
    issueCount: number;
    failedPipelineCount: number;
  };
  byType: Record<BriefingEventType, NormalizedBriefingEvent[]>;
}

interface RenderInput {
  date: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
  aiSummary?: BriefingAiSummary;
}

function renderEventInputs(input: RenderInput) {
  return input.events.map((event, index) => ({
    event,
    rawPayload: input.rawPayloadByEventIndex?.[index],
  }));
}

export function aggregateEvents(events: NormalizedBriefingEvent[]): BriefingAggregate {
  const byType: BriefingAggregate['byType'] = {
    push: [],
    tag: [],
    merge_request: [],
    issue: [],
    note: [],
    pipeline: [],
    release: [],
    unsupported: [],
  };

  for (const event of events) {
    byType[event.eventType].push(event);
  }

  return {
    overview: {
      projectCount: new Set(events.map((event) => `${event.provider}:${event.externalPath}`)).size,
      eventCount: events.length,
      mergeRequestCount: byType.merge_request.length,
      issueCount: byType.issue.length,
      failedPipelineCount: byType.pipeline.filter((event) => event.summary.status === 'failed')
        .length,
    },
    byType,
  };
}

function markdownEventList(events: NormalizedBriefingEvent[]) {
  if (events.length === 0) {
    return '- 本日无相关记录。';
  }

  return events
    .map((event) => {
      const action = event.action ? `${event.action}: ` : '';
      const commitCount =
        typeof event.summary.commitCount === 'number' && event.summary.commitCount > 0
          ? `，${event.summary.commitCount} 个提交`
          : '';
      const detail =
        event.eventType === 'push' && !event.commits?.length
          ? `推送到 ${event.subject}${commitCount}`
          : `${action}${event.subject}`;
      return `- ${detail}（${event.projectName}）`;
    })
    .join('\n');
}

function markdownAiSummarySection(summary: BriefingAiSummary) {
  const providerLabel =
    summary.aiProvider === 'cursor' ? 'Cursor' : summary.aiProvider === 'codex' ? 'Codex' : 'AI';
  const sourceNote =
    summary.source === 'ai'
      ? `（${providerLabel} 归纳，基于当日提交与研发事件）`
      : '（规则归纳；配置 AI_EXECUTOR_PROVIDER 与对应凭据后可启用 AI）';
  const lines = [
    `## 今日研发摘要${sourceNote}`,
    '',
    `**${summary.headline}**`,
    '',
    summary.summaryParagraph,
  ];

  const appendWorkItems = (title: string, items: BriefingAiSummary['features']) => {
    if (items.length === 0) {
      return;
    }
    lines.push('', `### ${title}`);
    for (const item of items) {
      const repos = item.repositories.length > 0 ? ` [${item.repositories.join(', ')}]` : '';
      lines.push(`- **${item.title}**${repos}`);
      if (item.detail.trim()) {
        lines.push(`  - ${item.detail}`);
      }
    }
  };

  appendWorkItems('新功能 / 能力', summary.features);
  appendWorkItems('问题修复', summary.fixes);

  if (summary.risks.length > 0) {
    lines.push('', '### 风险与关注', ...summary.risks.map((item) => `- ${item}`));
  }
  if (summary.otherNotes.length > 0) {
    lines.push('', '### 其它', ...summary.otherNotes.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}

function markdownCommitSummarySection(input: RenderInput) {
  const commits = collectDailyCommits(renderEventInputs(input));
  const summary = summarizeDailyCommits(commits);
  const mergedMrs = input.events.filter(
    (event) =>
      event.eventType === 'merge_request' &&
      (event.action === 'merge' || event.summary.state === 'merged'),
  );

  const lines = [
    '## 提交明细（按 message 归类）',
    `- 提交 ${summary.totalCommits} 个，涉及 ${summary.repositoryCount} 个仓库`,
  ];

  if (summary.features.length > 0) {
    lines.push('', '### 新功能 / 能力', ...summary.features.map((item) => formatCommitBullet(item)));
  }
  if (summary.fixes.length > 0) {
    lines.push('', '### 问题修复', ...summary.fixes.map((item) => formatCommitBullet(item)));
  }
  if (summary.other.length > 0) {
    lines.push('', '### 其他改动', ...summary.other.map((item) => formatCommitBullet(item)));
  }
  if (
    summary.totalCommits === 0 &&
    mergedMrs.length === 0 &&
    input.events.length === 0
  ) {
    lines.push('- 本日暂无 webhook 事件，请确认数据源已配置且 GitLab/GitHub 已推送当日变更。');
  } else if (summary.totalCommits === 0) {
    lines.push(
      '- 未解析到提交说明（推送 webhook 可能未包含 commits 列表）；以下为合并请求与其它活动。',
    );
  }

  if (mergedMrs.length > 0) {
    lines.push(
      '',
      '### 已合并合并请求',
      ...mergedMrs.map((event) => {
        const action = event.action ? `${event.action}: ` : '';
        return `- ${action}${event.subject}（${event.projectName}）`;
      }),
    );
  }

  return lines.join('\n');
}

export function renderBriefingMarkdown(input: RenderInput) {
  const aggregate = aggregateEvents(input.events);
  const summaryBlocks = [
    input.aiSummary ? markdownAiSummarySection(input.aiSummary) : markdownCommitSummarySection(input),
  ];
  if (input.aiSummary) {
    summaryBlocks.push('', markdownCommitSummarySection(input));
  }

  return [
    `# 研发日报 - ${input.date}`,
    '',
    ...summaryBlocks,
    '',
    '## 活动概览',
    `- 仓库/项目：${aggregate.overview.projectCount}`,
    `- 事件总数：${aggregate.overview.eventCount}`,
    `- 合并请求：${aggregate.overview.mergeRequestCount}`,
    `- Issue：${aggregate.overview.issueCount}`,
    `- 失败流水线：${aggregate.overview.failedPipelineCount}`,
    '',
    '## 代码推送',
    markdownEventList(aggregate.byType.push),
    '',
    '## 合并请求',
    markdownEventList(aggregate.byType.merge_request),
    '',
    '## Issue',
    markdownEventList(aggregate.byType.issue),
    '',
    '## 流水线',
    markdownEventList(aggregate.byType.pipeline),
    '',
    '## 标签与发布',
    markdownEventList([...aggregate.byType.tag, ...aggregate.byType.release]),
    '',
    '## 评论',
    markdownEventList(aggregate.byType.note),
  ].join('\n');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlEventList(events: NormalizedBriefingEvent[]) {
  if (events.length === 0) {
    return '<ul><li>本日无相关记录。</li></ul>';
  }

  const items = events
    .map((event) => {
      const action = event.action ? `${event.action}: ` : '';
      const commitCount =
        typeof event.summary.commitCount === 'number' && event.summary.commitCount > 0
          ? `，${event.summary.commitCount} 个提交`
          : '';
      const detail =
        event.eventType === 'push' && !event.commits?.length
          ? `推送到 ${event.subject}${commitCount}`
          : `${action}${event.subject}`;
      return `<li>${escapeHtml(detail)} <small>${escapeHtml(event.projectName)}</small></li>`;
    })
    .join('');

  return `<ul>${items}</ul>`;
}

function htmlAiSummarySection(summary: BriefingAiSummary) {
  const providerLabel =
    summary.aiProvider === 'cursor' ? 'Cursor' : summary.aiProvider === 'codex' ? 'Codex' : 'AI';
  const sourceNote =
    summary.source === 'ai'
      ? `（${providerLabel} 归纳，基于当日提交与研发事件）`
      : '（规则归纳；配置 AI_EXECUTOR_PROVIDER 与对应凭据后可启用 AI）';
  const parts = [
    `<h2>今日研发摘要${escapeHtml(sourceNote)}</h2>`,
    `<p><strong>${escapeHtml(summary.headline)}</strong></p>`,
    `<p>${escapeHtml(summary.summaryParagraph)}</p>`,
  ];

  const appendWorkItems = (title: string, items: BriefingAiSummary['features']) => {
    if (items.length === 0) {
      return;
    }
    parts.push(`<h3>${escapeHtml(title)}</h3><ul>`);
    for (const item of items) {
      const repos =
        item.repositories.length > 0
          ? ` <small>[${escapeHtml(item.repositories.join(', '))}]</small>`
          : '';
      parts.push(`<li><strong>${escapeHtml(item.title)}</strong>${repos}`);
      if (item.detail.trim()) {
        parts.push(`<br>${escapeHtml(item.detail)}`);
      }
      parts.push('</li>');
    }
    parts.push('</ul>');
  };

  appendWorkItems('新功能 / 能力', summary.features);
  appendWorkItems('问题修复', summary.fixes);

  if (summary.risks.length > 0) {
    parts.push('<h3>风险与关注</h3><ul>');
    for (const item of summary.risks) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
  }
  if (summary.otherNotes.length > 0) {
    parts.push('<h3>其它</h3><ul>');
    for (const item of summary.otherNotes) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
  }

  return parts.join('');
}

function htmlCommitSummarySection(input: RenderInput) {
  const commits = collectDailyCommits(renderEventInputs(input));
  const summary = summarizeDailyCommits(commits);
  const mergedMrs = input.events.filter(
    (event) =>
      event.eventType === 'merge_request' &&
      (event.action === 'merge' || event.summary.state === 'merged'),
  );

  const parts = [
    '<h2>提交明细（按 message 归类）</h2>',
    '<ul>',
    `<li>提交 ${summary.totalCommits} 个，涉及 ${summary.repositoryCount} 个仓库</li>`,
    '</ul>',
  ];

  const appendList = (title: string, items: Array<{ title: string; projectName: string; author?: string }>) => {
    if (items.length === 0) {
      return;
    }
    parts.push(`<h3>${escapeHtml(title)}</h3><ul>`);
    for (const item of items) {
      const author = item.author ? ` — ${escapeHtml(item.author)}` : '';
      parts.push(
        `<li>${escapeHtml(item.title)} <small>[${escapeHtml(item.projectName)}]</small>${author}</li>`,
      );
    }
    parts.push('</ul>');
  };

  appendList('新功能 / 能力', summary.features);
  appendList('问题修复', summary.fixes);
  appendList('其他改动', summary.other);

  if (summary.totalCommits === 0 && mergedMrs.length === 0 && input.events.length === 0) {
    parts.push('<p>本日暂无 webhook 事件，请确认数据源已配置且 GitLab/GitHub 已推送当日变更。</p>');
  } else if (summary.totalCommits === 0) {
    parts.push(
      '<p>未解析到提交说明（推送 webhook 可能未包含 commits 列表）；以下为合并请求与其它活动。</p>',
    );
  }

  if (mergedMrs.length > 0) {
    parts.push('<h3>已合并合并请求</h3><ul>');
    for (const event of mergedMrs) {
      const action = event.action ? `${event.action}: ` : '';
      parts.push(
        `<li>${escapeHtml(action)}${escapeHtml(event.subject)} <small>${escapeHtml(
          event.projectName,
        )}</small></li>`,
      );
    }
    parts.push('</ul>');
  }

  return parts.join('');
}

export function renderBriefingHtml(input: RenderInput) {
  const aggregate = aggregateEvents(input.events);
  const summaryHtml = input.aiSummary
    ? htmlAiSummarySection(input.aiSummary)
    : htmlCommitSummarySection(input);
  const commitAppendix = input.aiSummary ? htmlCommitSummarySection(input) : '';

  return [
    `<h1>研发日报 - ${escapeHtml(input.date)}</h1>`,
    summaryHtml,
    commitAppendix,
    '<h2>活动概览</h2>',
    '<ul>',
    `<li>仓库/项目：${aggregate.overview.projectCount}</li>`,
    `<li>事件总数：${aggregate.overview.eventCount}</li>`,
    `<li>合并请求：${aggregate.overview.mergeRequestCount}</li>`,
    `<li>Issue：${aggregate.overview.issueCount}</li>`,
    `<li>失败流水线：${aggregate.overview.failedPipelineCount}</li>`,
    '</ul>',
    '<h2>代码推送</h2>',
    htmlEventList(aggregate.byType.push),
    '<h2>合并请求</h2>',
    htmlEventList(aggregate.byType.merge_request),
    '<h2>Issue</h2>',
    htmlEventList(aggregate.byType.issue),
    '<h2>流水线</h2>',
    htmlEventList(aggregate.byType.pipeline),
    '<h2>标签与发布</h2>',
    htmlEventList([...aggregate.byType.tag, ...aggregate.byType.release]),
    '<h2>评论</h2>',
    htmlEventList(aggregate.byType.note),
  ].join('\n');
}
