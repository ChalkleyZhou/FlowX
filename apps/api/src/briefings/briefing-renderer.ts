import type { BriefingAiSummary, BriefingAiTopic } from './briefing-ai-summarizer.service';
import {
  categorizeCommitMessage,
  collectDailyCommits,
  COMMIT_CATEGORY_LABELS,
  COMMIT_CATEGORY_ORDER,
  type BriefingCommit,
  type CommitCategory,
} from './briefing-commits';
import type { BriefingEventType, NormalizedBriefingEvent } from './briefing-events';
import type { BriefingPeriod } from './dto/generate-briefing.dto';

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
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
  aiSummary?: BriefingAiSummary;
}

interface DevelopmentRecordSection {
  category: CommitCategory;
  label: string;
  commits: BriefingCommit[];
}

export function formatBriefingTitle(
  projectName: string,
  date: string,
  period: BriefingPeriod = 'DAILY',
) {
  const name = projectName.trim();
  const title = period === 'WEEKLY' ? '项目变化周报' : '项目变化简报';
  if (!name) {
    return `${title} - ${date}`;
  }
  return `${name} · ${title} · ${date}`;
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

function firstLine(message: string) {
  return message.split('\n')[0]?.trim() || message.trim();
}

function collectCommits(input: RenderInput) {
  return collectDailyCommits(renderEventInputs(input));
}

function developmentRecordSections(commits: BriefingCommit[]): DevelopmentRecordSection[] {
  const grouped = new Map<CommitCategory, BriefingCommit[]>();
  for (const commit of commits) {
    const category = categorizeCommitMessage(commit.message);
    grouped.set(category, [...(grouped.get(category) ?? []), commit]);
  }
  return COMMIT_CATEGORY_ORDER.flatMap((category) => {
    const items = grouped.get(category) ?? [];
    return items.length > 0
      ? [{ category, label: COMMIT_CATEGORY_LABELS[category], commits: items }]
      : [];
  });
}

function overviewLines(input: RenderInput, commitCount: number) {
  const headline = input.aiSummary?.headline.trim() ?? '';
  const paragraph = input.aiSummary?.summaryParagraph.trim() ?? '';
  if (headline || paragraph) {
    return [headline, paragraph].filter(Boolean);
  }
  if (commitCount === 0) {
    return [
      input.period === 'WEEKLY'
        ? '本周暂无可归纳的项目变化。'
        : '今日暂无可归纳的项目变化。',
    ];
  }
  return [
    input.period === 'WEEKLY'
      ? `本周共记录 ${commitCount} 次提交，现有信息不足以形成可靠的项目变化主题。`
      : `今日共记录 ${commitCount} 次提交，现有信息不足以形成可靠的项目变化主题。`,
  ];
}

function overviewTitle(period: BriefingPeriod) {
  return period === 'WEEKLY' ? '本周概览' : '今日概览';
}

function appendMarkdownTopic(lines: string[], topic: BriefingAiTopic) {
  lines.push('', `### ${topic.title}`, '', topic.summary);
  if (topic.modules.length > 0) {
    lines.push('', `涉及模块：${topic.modules.join('、')}`);
  }
  for (const reference of topic.commitReferences) {
    lines.push('', `依据：${reference.title} [${reference.repository}]`);
  }
}

function renderMarkdownContent(input: RenderInput) {
  const commits = collectCommits(input);
  const sections = developmentRecordSections(commits);
  const lines = [`## ${overviewTitle(input.period)}`, '', ...overviewLines(input, commits.length)];

  if (input.aiSummary?.topics.length) {
    lines.push('', '## 主要变化');
    for (const topic of input.aiSummary.topics) {
      appendMarkdownTopic(lines, topic);
    }
  }

  if (input.aiSummary?.openQuestions.length) {
    lines.push(
      '',
      '## 待确认事项',
      '',
      ...input.aiSummary.openQuestions.map((item) => `- ${item}`),
    );
  }

  lines.push('', '## 研发记录');
  if (sections.length === 0) {
    lines.push('', '今日无 commit 记录。');
  }
  for (const section of sections) {
    lines.push('', `### ${section.label}`);
    for (const commit of section.commits) {
      const author = commit.author ? ` — ${commit.author}` : '';
      lines.push(`- ${firstLine(commit.message)} [${commit.projectName}]${author}`);
    }
  }

  return lines.join('\n');
}

export function renderBriefingMarkdown(input: RenderInput) {
  return [
    `# ${formatBriefingTitle(input.projectName, input.rangeLabel, input.period)}`,
    '',
    renderMarkdownContent(input),
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

function renderHtmlTopic(topic: BriefingAiTopic) {
  const parts = [`<h3>${escapeHtml(topic.title)}</h3>`, `<p>${escapeHtml(topic.summary)}</p>`];
  if (topic.modules.length > 0) {
    parts.push(`<p>涉及模块：${escapeHtml(topic.modules.join('、'))}</p>`);
  }
  parts.push('<ul>');
  for (const reference of topic.commitReferences) {
    parts.push(
      `<li>依据：${escapeHtml(reference.title)} [${escapeHtml(reference.repository)}]</li>`,
    );
  }
  parts.push('</ul>');
  return parts.join('');
}

function renderHtmlContent(input: RenderInput) {
  const commits = collectCommits(input);
  const sections = developmentRecordSections(commits);
  const parts = [`<h2>${escapeHtml(overviewTitle(input.period))}</h2>`];
  for (const line of overviewLines(input, commits.length)) {
    parts.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (input.aiSummary?.topics.length) {
    parts.push('<h2>主要变化</h2>');
    for (const topic of input.aiSummary.topics) {
      parts.push(renderHtmlTopic(topic));
    }
  }

  if (input.aiSummary?.openQuestions.length) {
    parts.push('<h2>待确认事项</h2><ul>');
    for (const item of input.aiSummary.openQuestions) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
  }

  parts.push('<h2>研发记录</h2>');
  if (sections.length === 0) {
    parts.push('<p>今日无 commit 记录。</p>');
  }
  for (const section of sections) {
    parts.push(`<h3>${escapeHtml(section.label)}</h3><ul>`);
    for (const commit of section.commits) {
      const author = commit.author ? ` — ${commit.author}` : '';
      parts.push(
        `<li>${escapeHtml(firstLine(commit.message))} [${escapeHtml(commit.projectName)}]${escapeHtml(author)}</li>`,
      );
    }
    parts.push('</ul>');
  }
  return parts.join('');
}

export function renderBriefingHtml(input: RenderInput) {
  return [
    `<h1>${escapeHtml(formatBriefingTitle(input.projectName, input.rangeLabel, input.period))}</h1>`,
    renderHtmlContent(input),
  ].join('\n');
}
