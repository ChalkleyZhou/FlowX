import type { BriefingAiSummary, BriefingAiWorkItem } from './briefing-ai-summarizer.service';
import {
  collectDailyCommits,
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

function toWorkItem(
  title: string,
  projectName: string,
  detail = '',
): BriefingAiWorkItem {
  return {
    title,
    detail,
    repositories: projectName ? [projectName] : [],
  };
}

function buildCommitBasedSummary(input: RenderInput): BriefingAiSummary {
  const commits = collectDailyCommits(renderEventInputs(input));
  const categorized = summarizeDailyCommits(commits);
  const mergedMrs = input.events.filter(
    (event) =>
      event.eventType === 'merge_request' &&
      (event.action === 'merge' || event.summary.state === 'merged'),
  );

  const features = categorized.features.map((item) =>
    toWorkItem(item.title, item.projectName),
  );
  const fixes = categorized.fixes.map((item) => toWorkItem(item.title, item.projectName));
  const others = categorized.other.map((item) => toWorkItem(item.title, item.projectName));

  for (const event of mergedMrs) {
    const action = event.action ? `${event.action}: ` : '';
    features.push(toWorkItem(`${action}${event.subject}`, event.projectName));
  }

  const risks: string[] = [];
  for (const event of input.events) {
    if (event.eventType !== 'pipeline') {
      continue;
    }
    const status = event.summary.status;
    const failed =
      status === 'failed' || event.action === 'failed' || event.action === 'failure';
    if (!failed) {
      continue;
    }
    risks.push(
      `${event.projectName}：${event.subject}（${status ?? event.action ?? 'failed'}）`,
    );
  }

  const hasWork =
    features.length > 0 || fixes.length > 0 || others.length > 0 || risks.length > 0;

  return {
    source: 'fallback',
    headline:
      categorized.totalCommits > 0
        ? `共 ${categorized.totalCommits} 次提交`
        : hasWork
          ? ''
          : '',
    summaryParagraph:
      input.events.length === 0
        ? '本日暂无研发活动记录。'
        : !hasWork && categorized.totalCommits === 0
          ? '本日有研发事件，但未解析到可归纳的提交说明。'
          : '',
    features,
    fixes,
    others,
    risks,
    otherNotes: [],
  };
}

function resolveSummary(input: RenderInput): BriefingAiSummary {
  return input.aiSummary ?? buildCommitBasedSummary(input);
}

function appendMarkdownWorkItems(
  lines: string[],
  title: string,
  items: BriefingAiWorkItem[],
) {
  if (items.length === 0) {
    return;
  }
  lines.push('', `### ${title}`);
  for (const item of items) {
    const repos = item.repositories.length > 0 ? ` [${item.repositories.join(', ')}]` : '';
    lines.push(`- ${item.title}${repos}`);
    if (item.detail.trim()) {
      lines.push(`  - ${item.detail}`);
    }
  }
}

function renderMainSummaryMarkdown(summary: BriefingAiSummary) {
  const lines = ['## 今日研发摘要'];

  if (summary.headline.trim()) {
    lines.push('', summary.headline.trim());
  }
  if (summary.summaryParagraph.trim()) {
    lines.push('', summary.summaryParagraph.trim());
  }

  const hasWork =
    summary.features.length +
      summary.fixes.length +
      summary.others.length +
      summary.risks.length +
      summary.otherNotes.length >
    0;

  if (!hasWork && !summary.headline.trim() && !summary.summaryParagraph.trim()) {
    lines.push('', '本日暂无研发活动记录。');
  }

  appendMarkdownWorkItems(lines, '新功能', summary.features);
  appendMarkdownWorkItems(lines, '问题修复', summary.fixes);
  appendMarkdownWorkItems(lines, '其它提交（说明里未写 feat/fix）', summary.others);

  if (summary.risks.length > 0) {
    lines.push('', '### 风险与关注', ...summary.risks.map((item) => `- ${item}`));
  }
  if (summary.otherNotes.length > 0) {
    lines.push('', '### 其它', ...summary.otherNotes.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}

export function renderBriefingMarkdown(input: RenderInput) {
  const summary = resolveSummary(input);

  return [`# 研发日报 - ${input.date}`, '', renderMainSummaryMarkdown(summary)].join('\n');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function appendHtmlWorkItems(
  parts: string[],
  title: string,
  items: BriefingAiWorkItem[],
) {
  if (items.length === 0) {
    return;
  }
  parts.push(`<h3>${escapeHtml(title)}</h3><ul>`);
  for (const item of items) {
    const repos =
      item.repositories.length > 0
        ? ` <small>[${escapeHtml(item.repositories.join(', '))}]</small>`
        : '';
    parts.push(`<li>${escapeHtml(item.title)}${repos}`);
    if (item.detail.trim()) {
      parts.push(`<br>${escapeHtml(item.detail)}`);
    }
    parts.push('</li>');
  }
  parts.push('</ul>');
}

function renderMainSummaryHtml(summary: BriefingAiSummary) {
  const parts = ['<h2>今日研发摘要</h2>'];

  if (summary.headline.trim()) {
    parts.push(`<p>${escapeHtml(summary.headline.trim())}</p>`);
  }
  if (summary.summaryParagraph.trim()) {
    parts.push(`<p>${escapeHtml(summary.summaryParagraph.trim())}</p>`);
  }

  const hasWork =
    summary.features.length +
      summary.fixes.length +
      summary.others.length +
      summary.risks.length +
      summary.otherNotes.length >
    0;

  if (!hasWork && !summary.headline.trim() && !summary.summaryParagraph.trim()) {
    parts.push('<p>本日暂无研发活动记录。</p>');
  }

  appendHtmlWorkItems(parts, '新功能', summary.features);
  appendHtmlWorkItems(parts, '问题修复', summary.fixes);
  appendHtmlWorkItems(parts, '其它提交（说明里未写 feat/fix）', summary.others);

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

export function renderBriefingHtml(input: RenderInput) {
  const summary = resolveSummary(input);

  return [`<h1>研发日报 - ${escapeHtml(input.date)}</h1>`, renderMainSummaryHtml(summary)].join(
    '\n',
  );
}
