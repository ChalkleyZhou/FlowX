import type { GitlabEventType, NormalizedGitlabEvent } from './gitlab-events';

export interface BriefingAggregate {
  overview: {
    projectCount: number;
    eventCount: number;
    mergeRequestCount: number;
    issueCount: number;
    failedPipelineCount: number;
  };
  byType: Record<GitlabEventType, NormalizedGitlabEvent[]>;
}

interface RenderInput {
  date: string;
  events: NormalizedGitlabEvent[];
}

export function aggregateEvents(events: NormalizedGitlabEvent[]): BriefingAggregate {
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
      projectCount: new Set(events.map((event) => event.gitlabProjectId)).size,
      eventCount: events.length,
      mergeRequestCount: byType.merge_request.length,
      issueCount: byType.issue.length,
      failedPipelineCount: byType.pipeline.filter((event) => event.summary.status === 'failed')
        .length,
    },
    byType,
  };
}

function markdownEventList(events: NormalizedGitlabEvent[]) {
  if (events.length === 0) {
    return '- No events for this section.';
  }

  return events
    .map((event) => {
      const action = event.action ? `${event.action}: ` : '';
      return `- ${action}${event.subject} (${event.projectName})`;
    })
    .join('\n');
}

export function renderBriefingMarkdown(input: RenderInput) {
  const aggregate = aggregateEvents(input.events);

  return [
    `# Daily Briefing - ${input.date}`,
    '',
    '## Overview',
    `- Projects: ${aggregate.overview.projectCount}`,
    `- Events: ${aggregate.overview.eventCount}`,
    `- Merge Requests: ${aggregate.overview.mergeRequestCount}`,
    `- Issues: ${aggregate.overview.issueCount}`,
    `- Failed Pipelines: ${aggregate.overview.failedPipelineCount}`,
    '',
    '## Code Activity',
    markdownEventList(aggregate.byType.push),
    '',
    '## Merge Requests',
    markdownEventList(aggregate.byType.merge_request),
    '',
    '## Issues',
    markdownEventList(aggregate.byType.issue),
    '',
    '## Pipelines',
    markdownEventList(aggregate.byType.pipeline),
    '',
    '## Tags and Releases',
    markdownEventList([...aggregate.byType.tag, ...aggregate.byType.release]),
    '',
    '## Notable Comments',
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

function htmlEventList(events: NormalizedGitlabEvent[]) {
  if (events.length === 0) {
    return '<ul><li>No events for this section.</li></ul>';
  }

  const items = events
    .map((event) => {
      const action = event.action ? `${event.action}: ` : '';
      return `<li>${escapeHtml(action)}${escapeHtml(event.subject)} <small>${escapeHtml(
        event.projectName,
      )}</small></li>`;
    })
    .join('');

  return `<ul>${items}</ul>`;
}

export function renderBriefingHtml(input: RenderInput) {
  const aggregate = aggregateEvents(input.events);

  return [
    `<h1>Daily Briefing - ${escapeHtml(input.date)}</h1>`,
    '<h2>Overview</h2>',
    '<ul>',
    `<li>Projects: ${aggregate.overview.projectCount}</li>`,
    `<li>Events: ${aggregate.overview.eventCount}</li>`,
    `<li>Merge Requests: ${aggregate.overview.mergeRequestCount}</li>`,
    `<li>Issues: ${aggregate.overview.issueCount}</li>`,
    `<li>Failed Pipelines: ${aggregate.overview.failedPipelineCount}</li>`,
    '</ul>',
    '<h2>Code Activity</h2>',
    htmlEventList(aggregate.byType.push),
    '<h2>Merge Requests</h2>',
    htmlEventList(aggregate.byType.merge_request),
    '<h2>Issues</h2>',
    htmlEventList(aggregate.byType.issue),
    '<h2>Pipelines</h2>',
    htmlEventList(aggregate.byType.pipeline),
    '<h2>Tags and Releases</h2>',
    htmlEventList([...aggregate.byType.tag, ...aggregate.byType.release]),
    '<h2>Notable Comments</h2>',
    htmlEventList(aggregate.byType.note),
  ].join('\n');
}

