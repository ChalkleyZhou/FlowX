import type { DailyCodeReviewUnitStatus } from '../common/types';
import { coerceStringArray, normalizeReviewFindings, type DailyCodeReviewUnitResult } from './daily-code-review.types';

export function formatDailyCodeReviewTitle(projectName: string, date: string) {
  const name = projectName.trim();
  const title = '每日 Code Review';
  if (!name) {
    return `${title} - ${date}`;
  }
  return `${name} · ${title} · ${date}`;
}

const STATUS_LABELS: Record<DailyCodeReviewUnitStatus, string> = {
  COMPLETED: '已完成',
  SKIPPED_NO_SKILL: '未配置 review skill',
  SKIPPED_NO_CHANGES: '无变更',
  SKIPPED_NO_REPO: '仓库未同步',
  FAILED: '失败',
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderFindingsList(title: string, items: unknown) {
  const normalized = coerceStringArray(items);
  if (normalized.length === 0) {
    return [];
  }
  return ['', `**${title}**`, ...normalized.map((item) => `- ${item}`)];
}

function renderUnitMarkdown(unit: DailyCodeReviewUnitResult) {
  const lines = [
    `## ${unit.repositoryName} / ${unit.ref}`,
    '',
    `- 状态：${STATUS_LABELS[unit.status]}`,
  ];

  if (unit.commits.length > 0) {
    lines.push('- 审查 commit：');
    for (const commit of unit.commits) {
      const author = commit.author ? ` (${commit.author})` : '';
      lines.push(`  - \`${commit.id.slice(0, 12)}\` ${commit.message.split('\n')[0]}${author}`);
    }
  }

  if (unit.skillHint) {
    lines.push('', unit.skillHint);
  }
  if (unit.errorMessage) {
    lines.push('', `错误：${unit.errorMessage}`);
  }

  if (unit.findings) {
    lines.push(
      ...renderFindingsList('问题', unit.findings.issues),
      ...renderFindingsList('缺陷', unit.findings.bugs),
      ...renderFindingsList('遗漏测试', unit.findings.missingTests),
      ...renderFindingsList('优化建议', unit.findings.suggestions),
      ...renderFindingsList('影响范围', unit.findings.impactScope),
    );
  }

  return lines;
}

function renderUnitHtml(unit: DailyCodeReviewUnitResult) {
  const commitItems =
    unit.commits.length === 0
      ? ''
      : `<ul>${unit.commits
          .map((commit) => {
            const author = commit.author ? ` (${escapeHtml(commit.author)})` : '';
            return `<li><code>${escapeHtml(commit.id.slice(0, 12))}</code> ${escapeHtml(commit.message.split('\n')[0] ?? '')}${author}</li>`;
          })
          .join('')}</ul>`;

  const findings = unit.findings ? normalizeReviewFindings(unit.findings) : null;
  const findingSections = findings
    ? (['issues', 'bugs', 'missingTests', 'suggestions', 'impactScope'] as const)
        .map((key) => {
          const items = findings[key];
          if (items.length === 0) {
            return '';
          }
          const label =
            key === 'issues'
              ? '问题'
              : key === 'bugs'
                ? '缺陷'
                : key === 'missingTests'
                  ? '遗漏测试'
                  : key === 'suggestions'
                    ? '优化建议'
                    : '影响范围';
          return `<h4>${label}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
        })
        .filter(Boolean)
        .join('')
    : '';

  return [
    `<h2>${escapeHtml(unit.repositoryName)} / ${escapeHtml(unit.ref)}</h2>`,
    `<p>状态：${escapeHtml(STATUS_LABELS[unit.status])}</p>`,
    commitItems,
    unit.skillHint ? `<p>${escapeHtml(unit.skillHint)}</p>` : '',
    unit.errorMessage ? `<p>错误：${escapeHtml(unit.errorMessage)}</p>` : '',
    findingSections,
  ]
    .filter(Boolean)
    .join('');
}

export function renderGeneratingDailyCodeReviewContent(input: {
  projectName: string;
  date: string;
  rangeLabel: string;
  unitCount: number;
}) {
  const title = formatDailyCodeReviewTitle(input.projectName, input.date);
  const unitSummary =
    input.unitCount > 0
      ? `已识别 ${input.unitCount} 个仓库/分支审查单元，AI 正在后台审查代码变更，稍后会自动更新。`
      : '今日无代码变更，AI 正在后台确认并生成报告，稍后会自动更新。';

  return {
    markdownContent: [
      `# ${title}`,
      '',
      `统计周期：${input.rangeLabel}`,
      '总体状态：GENERATING',
      '',
      unitSummary,
    ].join('\n'),
    htmlContent: [
      `<h1>${escapeHtml(title)}</h1>`,
      `<p>统计周期：${escapeHtml(input.rangeLabel)}</p>`,
      `<p>总体状态：GENERATING</p>`,
      `<p>${escapeHtml(unitSummary)}</p>`,
    ].join(''),
  };
}

export function renderDailyCodeReviewMarkdown(input: {
  projectName: string;
  date: string;
  rangeLabel: string;
  units: DailyCodeReviewUnitResult[];
  overallStatus: string;
}) {
  const lines = [
    `# ${formatDailyCodeReviewTitle(input.projectName, input.date)}`,
    '',
    `统计周期：${input.rangeLabel}`,
    `总体状态：${input.overallStatus}`,
    '',
  ];

  if (input.units.length === 0) {
    lines.push(emptyUnitsMessage(input.overallStatus));
    return lines.join('\n');
  }

  for (const unit of input.units) {
    lines.push(...renderUnitMarkdown(unit), '');
  }

  return lines.join('\n').trim();
}

export function renderDailyCodeReviewHtml(input: {
  projectName: string;
  date: string;
  rangeLabel: string;
  units: DailyCodeReviewUnitResult[];
  overallStatus: string;
}) {
  const body =
    input.units.length === 0
      ? `<p>${escapeHtml(emptyUnitsMessage(input.overallStatus))}</p>`
      : input.units.map((unit) => renderUnitHtml(unit)).join('');

  return [
    `<h1>${escapeHtml(formatDailyCodeReviewTitle(input.projectName, input.date))}</h1>`,
    `<p>统计周期：${escapeHtml(input.rangeLabel)}</p>`,
    `<p>总体状态：${escapeHtml(input.overallStatus)}</p>`,
    body,
  ].join('');
}

function emptyUnitsMessage(overallStatus: string) {
  if (overallStatus === 'SKIPPED_NO_CR_SOURCES') {
    return '未配置 Code Review 数据源，本次为空跑，未审查任何仓库。请在设置中为需要审查的仓库添加 Code Review 数据源。';
  }
  return '今日无代码变更，跳过审查。';
}
