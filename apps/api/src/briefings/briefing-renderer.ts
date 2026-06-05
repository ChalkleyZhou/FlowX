import type { BriefingAiSummary, BriefingAiWorkItem } from './briefing-ai-summarizer.service';
import {
  COMMIT_CATEGORY_LABELS,
  collectDailyCommits,
  orderedCommitCategoryGroups,
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
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
  aiSummary?: BriefingAiSummary;
}

export function formatBriefingTitle(projectName: string, date: string) {
  const name = projectName.trim();
  if (!name) {
    return `研发日报 - ${date}`;
  }
  return `${name} · 研发日报 · ${date}`;
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

function buildCommitWorkItemSections(input: RenderInput) {
  const categorized = summarizeDailyCommits(collectDailyCommits(renderEventInputs(input)));
  const sections = orderedCommitCategoryGroups(categorized).map((group) => ({
    label: group.label,
    items: group.commits.map((item) => toWorkItem(item.title, item.projectName)),
  }));

  const mergedMrs = input.events.filter(
    (event) =>
      event.eventType === 'merge_request' &&
      (event.action === 'merge' || event.summary.state === 'merged'),
  );
  if (mergedMrs.length > 0) {
    const featSection = sections.find((section) => section.label === COMMIT_CATEGORY_LABELS.feat);
    const mrItems = mergedMrs.map((event) => {
      const action = event.action ? `${event.action}: ` : '';
      return toWorkItem(`${action}${event.subject}`, event.projectName);
    });
    if (featSection) {
      featSection.items.push(...mrItems);
    } else {
      sections.unshift({ label: COMMIT_CATEGORY_LABELS.feat, items: mrItems });
    }
  }

  return { sections, totalCommits: categorized.totalCommits };
}

function collectPipelineRisks(input: RenderInput) {
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
  return risks;
}

function resolveNarrative(input: RenderInput) {
  const { sections, totalCommits } = buildCommitWorkItemSections(input);
  const risks = input.aiSummary?.risks ?? collectPipelineRisks(input);
  const otherNotes = input.aiSummary?.otherNotes ?? [];
  const hasCommitSections = sections.some((section) => section.items.length > 0);
  const hasWork = hasCommitSections || risks.length > 0 || otherNotes.length > 0;

  if (input.aiSummary) {
    return {
      headline: input.aiSummary.headline,
      summaryParagraph: input.aiSummary.summaryParagraph,
      risks,
      otherNotes,
      hasWork,
    };
  }

  return {
    headline: totalCommits > 0 ? `共 ${totalCommits} 次提交` : hasWork ? '' : '',
    summaryParagraph:
      input.events.length === 0
        ? '本日暂无研发活动记录。'
        : !hasWork && totalCommits === 0
          ? '本日有研发事件，但未解析到可归纳的提交说明。'
          : '',
    risks,
    otherNotes,
    hasWork,
  };
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

function renderMainSummaryMarkdown(input: RenderInput) {
  const narrative = resolveNarrative(input);
  const { sections } = buildCommitWorkItemSections(input);
  const lines = ['## 今日研发摘要'];

  if (narrative.headline.trim()) {
    lines.push('', narrative.headline.trim());
  }
  if (narrative.summaryParagraph.trim()) {
    lines.push('', narrative.summaryParagraph.trim());
  }

  if (
    !narrative.hasWork &&
    !narrative.headline.trim() &&
    !narrative.summaryParagraph.trim()
  ) {
    lines.push('', '本日暂无研发活动记录。');
  }

  for (const section of sections) {
    appendMarkdownWorkItems(lines, section.label, section.items);
  }

  if (narrative.risks.length > 0) {
    lines.push('', '### 风险与关注', ...narrative.risks.map((item) => `- ${item}`));
  }
  if (narrative.otherNotes.length > 0) {
    lines.push('', '### 其它', ...narrative.otherNotes.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}

export function renderBriefingMarkdown(input: RenderInput) {
  const title = formatBriefingTitle(input.projectName, input.date);

  return [`# ${title}`, '', renderMainSummaryMarkdown(input)].join('\n');
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

function renderMainSummaryHtml(input: RenderInput) {
  const narrative = resolveNarrative(input);
  const { sections } = buildCommitWorkItemSections(input);
  const parts = ['<h2>今日研发摘要</h2>'];

  if (narrative.headline.trim()) {
    parts.push(`<p>${escapeHtml(narrative.headline.trim())}</p>`);
  }
  if (narrative.summaryParagraph.trim()) {
    parts.push(`<p>${escapeHtml(narrative.summaryParagraph.trim())}</p>`);
  }

  if (
    !narrative.hasWork &&
    !narrative.headline.trim() &&
    !narrative.summaryParagraph.trim()
  ) {
    parts.push('<p>本日暂无研发活动记录。</p>');
  }

  for (const section of sections) {
    appendHtmlWorkItems(parts, section.label, section.items);
  }

  if (narrative.risks.length > 0) {
    parts.push('<h3>风险与关注</h3><ul>');
    for (const item of narrative.risks) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
  }
  if (narrative.otherNotes.length > 0) {
    parts.push('<h3>其它</h3><ul>');
    for (const item of narrative.otherNotes) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
  }

  return parts.join('');
}

export function renderBriefingHtml(input: RenderInput) {
  const title = formatBriefingTitle(input.projectName, input.date);

  return [`<h1>${escapeHtml(title)}</h1>`, renderMainSummaryHtml(input)].join('\n');
}
