# Weekly Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manually generated natural-week project change briefings while keeping current daily briefing behavior compatible.

**Architecture:** Reuse the existing `Briefing` model and generation pipeline, adding explicit period metadata and a Beijing natural-week window. The backend owns all period normalization; the frontend only sends `DAILY` or `WEEKLY` plus the selected date and renders returned period metadata.

**Tech Stack:** NestJS, TypeScript, Prisma, SQLite, Vitest, React, Vite, Tailwind, Radix/shadcn-style UI components.

---

## File Structure

- Modify `prisma/schema.prisma`: add `period`, `periodStart`, and `periodEnd` to `Briefing`.
- Create `prisma/migrations/20260617090000_weekly_briefings/migration.sql`: persist the new columns with a safe default.
- Modify `apps/api/src/briefings/briefing-time-window.ts`: add natural-week window helpers.
- Modify `apps/api/src/briefings/briefing-time-window.spec.ts`: cover Monday, Sunday, cross-month, and cross-year weeks.
- Modify `apps/api/src/briefings/dto/generate-briefing.dto.ts`: validate `period`.
- Modify `apps/api/src/briefings/briefing-facts.ts`: include period and range context in AI facts.
- Modify `apps/api/src/prompts/briefing-summary.prompt.ts`: remove daily-only wording and include the period range.
- Modify `apps/api/src/briefings/briefing-ai-summarizer.service.ts`: pass period context into facts and fallback summaries.
- Modify `apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts`: verify weekly fallback and prompt flow.
- Modify `apps/api/src/briefings/briefing-renderer.ts`: render daily and weekly labels, titles, and overview headings.
- Modify `apps/api/src/briefings/briefing-renderer.spec.ts`: verify weekly Markdown and HTML output.
- Modify `apps/api/src/briefings/briefings.service.ts`: normalize period, query the right window, and write period metadata.
- Modify `apps/api/src/briefings/briefings.service.spec.ts`: verify compatible daily behavior and weekly generation semantics.
- Modify `apps/api/src/briefings/delivery-targets.service.ts` only if delivery titles require period-aware formatting after renderer changes.
- Modify `apps/api/src/briefings/delivery-targets.service.spec.ts` only if the delivery title function signature changes.
- Modify `apps/web/src/types.ts`: add `BriefingPeriod` and period fields to `Briefing`.
- Modify `apps/web/src/api.ts`: allow `period` in `generateProjectBriefing`.
- Modify `apps/web/src/pages/BriefingsPage.tsx`: add period selector, weekly labels, and history display.
- Modify `apps/web/src/pages/BriefingsPage.test.tsx`: verify weekly generation payload and history type rendering.

---

### Task 1: Persist Briefing Period Metadata

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260617090000_weekly_briefings/migration.sql`

- [ ] **Step 1: Add Prisma fields**

In `prisma/schema.prisma`, update the `Briefing` model:

```prisma
model Briefing {
  id              String        @id @default(cuid())
  projectId       String
  project         Project       @relation(fields: [projectId], references: [id])
  workspaceId     String
  workspace       Workspace     @relation(fields: [workspaceId], references: [id])
  date            DateTime
  period          String        @default("DAILY")
  periodStart     DateTime?
  periodEnd       DateTime?
  scopeKey        String
  scope           Json
  status          String        @default("GENERATED")
  markdownContent String
  htmlContent     String
  eventCount      Int           @default(0)
  generatedAt     DateTime?
  sentAt          DateTime?
  errorMessage    String?
  deliveryLogs    DeliveryLog[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([projectId, date, scopeKey])
  @@index([projectId, date])
  @@index([workspaceId, date])
  @@index([projectId, period, periodStart])
}
```

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260617090000_weekly_briefings/migration.sql`:

```sql
ALTER TABLE "Briefing" ADD COLUMN "period" TEXT NOT NULL DEFAULT 'DAILY';
ALTER TABLE "Briefing" ADD COLUMN "periodStart" DATETIME;
ALTER TABLE "Briefing" ADD COLUMN "periodEnd" DATETIME;
CREATE INDEX "Briefing_projectId_period_periodStart_idx" ON "Briefing"("projectId", "period", "periodStart");
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm prisma:generate
```

Expected: command exits 0 and Prisma client generation completes.

- [ ] **Step 4: Commit schema work**

```bash
git add prisma/schema.prisma prisma/migrations/20260617090000_weekly_briefings/migration.sql
git commit -m "feat: 为简报增加周期元数据"
```

---

### Task 2: Add Natural Week Window Helpers

**Files:**
- Modify: `apps/api/src/briefings/briefing-time-window.spec.ts`
- Modify: `apps/api/src/briefings/briefing-time-window.ts`

- [ ] **Step 1: Write failing natural-week tests**

Append these tests inside `describe('briefing-time-window', () => { ... })`:

```ts
  it('resolves a Monday input to the same Beijing natural week', () => {
    const window = briefingWeekWindow('2026-06-15');

    expect(window.startDate).toBe('2026-06-15');
    expect(window.endDate).toBe('2026-06-21');
    expect(window.start.toISOString()).toBe('2026-06-14T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-06-21T16:00:00.000Z');
  });

  it('resolves a Sunday input to the preceding Monday natural week', () => {
    const window = briefingWeekWindow('2026-06-21');

    expect(window.startDate).toBe('2026-06-15');
    expect(window.endDate).toBe('2026-06-21');
    expect(window.start.toISOString()).toBe('2026-06-14T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-06-21T16:00:00.000Z');
  });

  it('resolves a natural week across month boundaries', () => {
    const window = briefingWeekWindow('2026-07-01');

    expect(window.startDate).toBe('2026-06-29');
    expect(window.endDate).toBe('2026-07-05');
    expect(window.start.toISOString()).toBe('2026-06-28T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-07-05T16:00:00.000Z');
  });

  it('resolves a natural week across year boundaries', () => {
    const window = briefingWeekWindow('2027-01-01');

    expect(window.startDate).toBe('2026-12-28');
    expect(window.endDate).toBe('2027-01-03');
    expect(window.start.toISOString()).toBe('2026-12-27T16:00:00.000Z');
    expect(window.end.toISOString()).toBe('2027-01-03T16:00:00.000Z');
  });
```

Also add `briefingWeekWindow` to the import list.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-time-window.spec.ts
```

Expected: fails because `briefingWeekWindow` is not exported.

- [ ] **Step 3: Implement week helper**

In `apps/api/src/briefings/briefing-time-window.ts`, export:

```ts
export function briefingWeekWindow(date: string) {
  const startDate = startOfBeijingNaturalWeek(date);
  const endDate = shiftCalendarDate(startDate, 6);
  return {
    start: beijingLocalDateTimeToUtc(startDate, 0, 0, 0),
    end: beijingLocalDateTimeToUtc(shiftCalendarDate(startDate, 7), 0, 0, 0),
    startDate,
    endDate,
  };
}

function startOfBeijingNaturalWeek(date: string) {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return shiftCalendarDate(date, -daysSinceMonday);
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-time-window.spec.ts
```

Expected: all tests in this file pass.

- [ ] **Step 5: Commit week helper**

```bash
git add apps/api/src/briefings/briefing-time-window.ts apps/api/src/briefings/briefing-time-window.spec.ts
git commit -m "feat: 增加简报自然周窗口"
```

---

### Task 3: Add Period DTO Validation

**Files:**
- Modify: `apps/api/src/briefings/dto/generate-briefing.dto.ts`

- [ ] **Step 1: Update DTO**

Replace the DTO with:

```ts
import { IsBoolean, IsDateString, IsIn, IsOptional } from 'class-validator';

export const BRIEFING_PERIODS = ['DAILY', 'WEEKLY'] as const;
export type BriefingPeriod = (typeof BRIEFING_PERIODS)[number];

export class GenerateBriefingDto {
  @IsOptional()
  @IsIn(BRIEFING_PERIODS)
  period?: BriefingPeriod;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}
```

- [ ] **Step 2: Run API typecheck through build**

Run:

```bash
pnpm --filter flowx-api build
```

Expected: build passes.

- [ ] **Step 3: Commit DTO change**

```bash
git add apps/api/src/briefings/dto/generate-briefing.dto.ts
git commit -m "feat: 为简报生成接口增加周期参数"
```

---

### Task 4: Make AI Facts And Prompt Period-Aware

**Files:**
- Modify: `apps/api/src/briefings/briefing-facts.ts`
- Modify: `apps/api/src/prompts/briefing-summary.prompt.ts`
- Modify: `apps/api/src/briefings/briefing-ai-summarizer.service.ts`
- Modify: `apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts`

- [ ] **Step 1: Write failing summarizer tests**

Add a weekly fallback case to `apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts`:

```ts
  it('uses weekly fallback copy when a weekly briefing has no commits', async () => {
    const summary = await createService().summarize({
      period: 'WEEKLY',
      date: '2026-06-15',
      rangeLabel: '2026-06-15 至 2026-06-21',
      projectName: 'FlowX',
      events: [],
    });

    expect(summary).toMatchObject({
      source: 'fallback',
      headline: '',
      summaryParagraph: '本周暂无可归纳的项目变化。',
      topics: [],
      openQuestions: [],
    });
  });
```

Add a prompt assertion if the file already has AI-enabled tests:

```ts
expect(runStructuredJsonStage.mock.calls[0]?.[1]).toContain('周期：WEEKLY');
expect(runStructuredJsonStage.mock.calls[0]?.[1]).toContain('范围：2026-06-15 至 2026-06-21');
expect(runStructuredJsonStage.mock.calls[0]?.[1]).toContain('一个周期的 commit');
```

- [ ] **Step 2: Run focused summarizer tests and verify failure**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts
```

Expected: fails because `summarize` does not accept period fields and fallback text is daily-only.

- [ ] **Step 3: Update facts payload**

In `apps/api/src/briefings/briefing-facts.ts`, add period fields:

```ts
import type { BriefingPeriod } from './dto/generate-briefing.dto';

export interface BriefingFactsPayload {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  overview: {
    repositoryCount: number;
    commitCount: number;
  };
  commits: Array<{
    id: string;
    repository: string;
    ref?: string;
    message: string;
    author?: string;
    category: CommitCategory;
    scope?: string;
  }>;
}

interface BuildFactsInput {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
}
```

Return these fields from `buildBriefingFacts`:

```ts
  return {
    period: input.period,
    date: input.date,
    rangeLabel: input.rangeLabel,
    projectName: input.projectName,
    overview: {
      repositoryCount: commitSummary.repositoryCount,
      commitCount: commitSummary.totalCommits,
    },
    commits: commitFacts(commits),
  };
```

- [ ] **Step 4: Update prompt copy**

In `apps/api/src/prompts/briefing-summary.prompt.ts`, replace daily-specific lines with:

```ts
  return [
    '你需要把一个周期的 commit 整理成产品、测试和研发都能理解的「项目变化简报」。',
    '',
    '要求：',
    '1. commit 是唯一事实来源。只能整理、合并和改写下方 JSON，不能补充未出现的业务背景、用户对象或结论。',
    '2. 将明确描述同一变化的 commits 聚合成一个 topic；仅类型相同不能作为聚合依据。',
    '3. 每个 topic 必须引用至少一个真实 commit，repository 与 commitId 必须逐字使用事实数据中的值。',
    '4. modules 只能使用关联 commits 中明确出现的 repository 或 scope；无法确认时返回空数组。',
    '5. 信息量低、无法形成可靠项目变化的 commit 可以不进入 topics，它仍会出现在研发记录附录。',
    '6. 缺失的信息写入 openQuestions，只说明缺少什么，不猜测答案；没有待确认内容时返回空数组。',
    '7. 禁止宣称可测试、已上线、已发布、已验收，禁止生成验证建议、潜在风险、排期影响、用户反馈或虚构业务价值。',
    '8. headline 和 summaryParagraph 只概括可由 topics 支持的变化；topics 为空时应保守说明无法可靠归纳。',
    '9. 输出必须符合 JSON Schema（由 CLI 校验），不要输出 Markdown 或额外说明。',
    '',
    `周期：${facts.period}`,
    `日期：${facts.date}`,
    `范围：${facts.rangeLabel}`,
    `项目：${facts.projectName}`,
    '',
    '事实数据：',
    factsJson,
  ].join('\n');
```

- [ ] **Step 5: Update summarizer input and fallback**

In `apps/api/src/briefings/briefing-ai-summarizer.service.ts`, import `BriefingPeriod`, update `SummarizeInput`, and pass the new fields to `buildBriefingFacts`:

```ts
import type { BriefingPeriod } from './dto/generate-briefing.dto';

interface SummarizeInput {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
}
```

Update fallback:

```ts
  private buildFallbackSummary(facts: BriefingFactsPayload): BriefingAiSummary {
    const emptyCopy =
      facts.period === 'WEEKLY'
        ? '本周暂无可归纳的项目变化。'
        : '今日暂无可归纳的项目变化。';
    return {
      source: 'fallback',
      headline:
        facts.overview.commitCount > 0 ? `共 ${facts.overview.commitCount} 次提交` : '',
      summaryParagraph:
        facts.overview.commitCount === 0 ? emptyCopy : '',
      topics: [],
      openQuestions: [],
    };
  }
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts
```

Expected: summarizer tests pass.

- [ ] **Step 7: Commit AI period context**

```bash
git add apps/api/src/briefings/briefing-facts.ts apps/api/src/prompts/briefing-summary.prompt.ts apps/api/src/briefings/briefing-ai-summarizer.service.ts apps/api/src/briefings/briefing-ai-summarizer.service.spec.ts
git commit -m "feat: 让简报 AI 总结支持周期上下文"
```

---

### Task 5: Render Weekly Titles And Sections

**Files:**
- Modify: `apps/api/src/briefings/briefing-renderer.spec.ts`
- Modify: `apps/api/src/briefings/briefing-renderer.ts`

- [ ] **Step 1: Write failing renderer tests**

Add tests to `apps/api/src/briefings/briefing-renderer.spec.ts`:

```ts
  it('renders weekly markdown with a weekly title and overview heading', () => {
    const markdown = renderBriefingMarkdown({
      period: 'WEEKLY',
      date: '2026-06-15',
      rangeLabel: '2026-06-15 至 2026-06-21',
      projectName: 'FlowX',
      events: [],
    });

    expect(markdown).toContain('# FlowX · 项目变化周报 · 2026-06-15 至 2026-06-21');
    expect(markdown).toContain('## 本周概览');
    expect(markdown).toContain('本周暂无可归纳的项目变化。');
  });

  it('renders weekly html with a weekly title and overview heading', () => {
    const html = renderBriefingHtml({
      period: 'WEEKLY',
      date: '2026-06-15',
      rangeLabel: '2026-06-15 至 2026-06-21',
      projectName: 'FlowX',
      events: [],
    });

    expect(html).toContain('<h1>FlowX · 项目变化周报 · 2026-06-15 至 2026-06-21</h1>');
    expect(html).toContain('<h2>本周概览</h2>');
    expect(html).toContain('<p>本周暂无可归纳的项目变化。</p>');
  });
```

Update existing renderer test calls to include:

```ts
period: 'DAILY',
rangeLabel: '2026-06-03',
```

- [ ] **Step 2: Run focused renderer tests and verify failure**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-renderer.spec.ts
```

Expected: fails because render input is daily-only.

- [ ] **Step 3: Update renderer input and title helpers**

In `apps/api/src/briefings/briefing-renderer.ts`, import `BriefingPeriod` and update helpers:

```ts
import type { BriefingPeriod } from './dto/generate-briefing.dto';

interface RenderInput {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
  aiSummary?: BriefingAiSummary;
}

export function formatBriefingTitle(projectName: string, date: string, period: BriefingPeriod = 'DAILY') {
  const name = projectName.trim();
  const title = period === 'WEEKLY' ? '项目变化周报' : '项目变化简报';
  if (!name) {
    return `${title} - ${date}`;
  }
  return `${name} · ${title} · ${date}`;
}

function overviewTitle(period: BriefingPeriod) {
  return period === 'WEEKLY' ? '本周概览' : '今日概览';
}
```

Update empty overview copy:

```ts
  if (commitCount === 0) {
    return [input.period === 'WEEKLY' ? '本周暂无可归纳的项目变化。' : '今日暂无可归纳的项目变化。'];
  }
  return [
    input.period === 'WEEKLY'
      ? `本周共记录 ${commitCount} 次提交，现有信息不足以形成可靠的项目变化主题。`
      : `今日共记录 ${commitCount} 次提交，现有信息不足以形成可靠的项目变化主题。`,
  ];
```

Use `overviewTitle(input.period)` in Markdown and HTML, and pass `input.rangeLabel` into `formatBriefingTitle`.

- [ ] **Step 4: Run focused renderer tests**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefing-renderer.spec.ts
```

Expected: renderer tests pass.

- [ ] **Step 5: Commit renderer change**

```bash
git add apps/api/src/briefings/briefing-renderer.ts apps/api/src/briefings/briefing-renderer.spec.ts
git commit -m "feat: 渲染项目变化周报"
```

---

### Task 6: Generate Weekly Briefings In Service

**Files:**
- Modify: `apps/api/src/briefings/briefings.service.spec.ts`
- Modify: `apps/api/src/briefings/briefings.service.ts`
- Modify: `apps/api/src/briefings/delivery-targets.service.ts`
- Modify: `apps/api/src/briefings/delivery-targets.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Add a weekly generation test to `apps/api/src/briefings/briefings.service.spec.ts`:

```ts
  it('generates a weekly project briefing from natural week events', async () => {
    projectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'FlowX',
      workspaceId: 'workspace-1',
      workspace: { repositories: [{ id: 'repo-1' }] },
    });
    configFindUnique.mockResolvedValue({ dailyHour: 22 });
    sourceFindMany.mockResolvedValue([{ id: 'source-1', repositoryId: 'repo-1' }]);
    briefingFindFirst.mockResolvedValue(null);
    eventFindMany.mockResolvedValue([]);
    briefingCreate.mockResolvedValue({ id: 'weekly-briefing' });

    await expect(
      createService().generateProjectBriefing('project-1', {
        period: 'WEEKLY',
        date: '2026-06-17',
      }),
    ).resolves.toEqual({ id: 'weekly-briefing' });

    expect(eventFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        briefingSourceId: { in: ['source-1'] },
        occurredAt: {
          gte: new Date('2026-06-14T16:00:00.000Z'),
          lt: new Date('2026-06-21T16:00:00.000Z'),
        },
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      period: 'WEEKLY',
      date: '2026-06-15',
      rangeLabel: '2026-06-15 至 2026-06-21',
      projectName: 'FlowX',
    }));
    expect(briefingCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        date: new Date('2026-06-14T16:00:00.000Z'),
        period: 'WEEKLY',
        periodStart: new Date('2026-06-14T16:00:00.000Z'),
        periodEnd: new Date('2026-06-21T16:00:00.000Z'),
        eventCount: 0,
      },
    });
    expect(briefingCreate.mock.calls[0]?.[0].data.scopeKey).toContain('"period":"WEEKLY"');
  });
```

Add a daily compatibility assertion to the existing daily generation test:

```ts
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({
      period: 'DAILY',
      date: '2026-06-03',
      rangeLabel: '2026-06-03',
    }));
    expect(briefingCreate.mock.calls[0]?.[0]).toMatchObject({
      data: expect.objectContaining({
        period: 'DAILY',
        periodStart: new Date('2026-06-02T14:00:00.000Z'),
        periodEnd: new Date('2026-06-03T14:00:00.000Z'),
      }),
    });
```

Add a regenerate sentAt assertion:

```ts
    expect(briefingUpdate).toHaveBeenCalledWith({
      where: { id: 'existing-briefing' },
      data: expect.objectContaining({
        sentAt: null,
      }),
    });
```

- [ ] **Step 2: Run focused service tests and verify failure**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefings.service.spec.ts
```

Expected: fails because the service ignores `period`.

- [ ] **Step 3: Implement period planning in service**

In `apps/api/src/briefings/briefings.service.ts`, import the new helpers and type:

```ts
import { type BriefingPeriod } from './dto/generate-briefing.dto';
import {
  briefingDateWindow,
  briefingWeekWindow,
  BRIEFING_TIMEZONE,
  dateAtBeijingMidnight,
  DEFAULT_BRIEFING_CUTOFF_HOUR,
  resolveBriefingDate,
} from './briefing-time-window';
```

Add a local plan type and helper:

```ts
interface BriefingPeriodPlan {
  period: BriefingPeriod;
  date: string;
  rangeLabel: string;
  windowStart: Date;
  windowEnd: Date;
  recordDate: Date;
}

function resolvePeriodPlan(input: {
  period: BriefingPeriod;
  date: string;
  cutoffHour: number;
}): BriefingPeriodPlan {
  if (input.period === 'WEEKLY') {
    const week = briefingWeekWindow(input.date);
    return {
      period: 'WEEKLY',
      date: week.startDate,
      rangeLabel: `${week.startDate} 至 ${week.endDate}`,
      windowStart: week.start,
      windowEnd: week.end,
      recordDate: week.start,
    };
  }

  const window = briefingDateWindow(input.date, input.cutoffHour);
  return {
    period: 'DAILY',
    date: input.date,
    rangeLabel: input.date,
    windowStart: window.start,
    windowEnd: window.end,
    recordDate: dateAtBeijingMidnight(input.date),
  };
}
```

In `generateProjectBriefing`, compute:

```ts
    const period = dto.period ?? 'DAILY';
    const requestedDate =
      dto.date?.trim() || resolveBriefingDate(new Date(), cutoffHour);
    const periodPlan = resolvePeriodPlan({
      period,
      date: requestedDate,
      cutoffHour,
    });
```

Update `scope`:

```ts
    const scope = {
      period: periodPlan.period,
      date: periodPlan.date,
      rangeLabel: periodPlan.rangeLabel,
      periodStart: periodPlan.windowStart.toISOString(),
      periodEnd: periodPlan.windowEnd.toISOString(),
      projectId,
      workspaceId: project.workspaceId,
      repositoryIds,
      briefingSourceIds: sourceIds,
      cutoffHour: periodPlan.period === 'DAILY' ? cutoffHour : null,
    };
```

Use `periodPlan.recordDate` in the existing lookup and create calls:

```ts
      where: {
        projectId,
        date: periodPlan.recordDate,
        scopeKey,
      },
```

Query events with:

```ts
        occurredAt: { gte: periodPlan.windowStart, lt: periodPlan.windowEnd },
```

Call summarizer and renderer with:

```ts
    const aiSummary = await this.briefingAiSummarizerService.summarize({
      period: periodPlan.period,
      date: periodPlan.date,
      rangeLabel: periodPlan.rangeLabel,
      projectName: project.name,
      events,
      rawPayloadByEventIndex,
    });
```

and pass `period`, `date`, and `rangeLabel` to both renderers.

Write period metadata:

```ts
      period: periodPlan.period,
      periodStart: periodPlan.windowStart,
      periodEnd: periodPlan.windowEnd,
```

- [ ] **Step 4: Update delivery title call if needed**

If `formatBriefingTitle` now accepts `(projectName, date, period)`, update `apps/api/src/briefings/delivery-targets.service.ts` so existing delivery behavior remains daily-compatible:

```ts
    const subject = formatBriefingTitle(
      briefing.projectName,
      briefing.date.toISOString().slice(0, 10),
    );
```

No behavior change is required for sending weekly briefings in this task because the persisted `markdownContent` and `htmlContent` already contain the weekly title.

- [ ] **Step 5: Run focused backend briefing tests**

Run:

```bash
pnpm --filter flowx-api test -- apps/api/src/briefings/briefings.service.spec.ts apps/api/src/briefings/delivery-targets.service.spec.ts
```

Expected: tests pass.

- [ ] **Step 6: Run all API tests**

Run:

```bash
pnpm --filter flowx-api test
```

Expected: all API tests pass.

- [ ] **Step 7: Commit service generation**

```bash
git add apps/api/src/briefings/briefings.service.ts apps/api/src/briefings/briefings.service.spec.ts apps/api/src/briefings/delivery-targets.service.ts apps/api/src/briefings/delivery-targets.service.spec.ts
git commit -m "feat: 支持手动生成自然周项目周报"
```

---

### Task 7: Add Weekly Briefing UI

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/pages/BriefingsPage.test.tsx`
- Modify: `apps/web/src/pages/BriefingsPage.tsx`

- [ ] **Step 1: Update frontend types and API helper**

In `apps/web/src/types.ts`, add:

```ts
export type BriefingPeriod = 'DAILY' | 'WEEKLY';
```

Update `Briefing`:

```ts
  period: BriefingPeriod;
  periodStart?: string | null;
  periodEnd?: string | null;
```

Update `scope`:

```ts
    period?: BriefingPeriod;
    rangeLabel?: string;
    periodStart?: string;
    periodEnd?: string;
```

In `apps/web/src/api.ts`, import `BriefingPeriod` and update the payload type:

```ts
    payload: {
      period?: BriefingPeriod;
      date?: string;
      regenerate?: boolean;
    },
```

- [ ] **Step 2: Write failing UI tests**

In `apps/web/src/pages/BriefingsPage.test.tsx`, update mocked briefing records to include:

```ts
      period: 'DAILY',
      periodStart: '2026-06-02T14:00:00.000Z',
      periodEnd: '2026-06-03T14:00:00.000Z',
```

Add a weekly generation test:

```ts
  it('generates a weekly project briefing when weekly period is selected', async () => {
    await renderPage();

    const weeklyOption = Array.from(document.querySelectorAll('[role="option"]')).find((item) =>
      item.textContent?.includes('周报'),
    );
    if (weeklyOption) {
      await act(async () => {
        weeklyOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    } else {
      const trigger = Array.from(document.querySelectorAll('button')).find((item) =>
        item.textContent?.includes('日报'),
      );
      await act(async () => {
        trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((item) =>
        item.textContent?.includes('周报'),
      );
      await act(async () => {
        option?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }

    expect(document.body.textContent).toContain('周内日期');
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('生成周报'),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(api.generateProjectBriefing).toHaveBeenCalledWith('project-1', {
      period: 'WEEKLY',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      regenerate: true,
    });
  });
```

Add a history rendering test:

```ts
  it('shows weekly briefing type and range in history', async () => {
    vi.mocked(api.getProjectBriefings).mockResolvedValue([
      {
        id: 'weekly-1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        date: '2026-06-14T16:00:00.000Z',
        period: 'WEEKLY',
        periodStart: '2026-06-14T16:00:00.000Z',
        periodEnd: '2026-06-21T16:00:00.000Z',
        scopeKey: 'weekly-scope',
        scope: { rangeLabel: '2026-06-15 至 2026-06-21' },
        status: 'GENERATED',
        markdownContent: '# Weekly',
        htmlContent: '<h1>Weekly</h1>',
        eventCount: 3,
        createdAt: '2026-06-21T16:00:00.000Z',
        updatedAt: '2026-06-21T16:00:00.000Z',
      },
    ]);

    await renderPage();

    expect(document.body.textContent).toContain('周报');
    expect(document.body.textContent).toContain('2026-06-15 至 2026-06-21');
  });
```

- [ ] **Step 3: Run focused web test and verify failure**

Run:

```bash
pnpm --filter flowx-web test -- apps/web/src/pages/BriefingsPage.test.tsx
```

Expected: fails because the UI has no period selector and no weekly history rendering.

- [ ] **Step 4: Implement UI helpers**

In `apps/web/src/pages/BriefingsPage.tsx`, import `BriefingPeriod`:

```ts
import type { Briefing, BriefingPeriod, Project } from '../types';
```

Add state:

```ts
  const [period, setPeriod] = useState<BriefingPeriod>('DAILY');
```

Add helper functions above the component:

```ts
function periodLabel(period: BriefingPeriod | string | undefined) {
  return period === 'WEEKLY' ? '周报' : '日报';
}

function briefingRangeLabel(briefing: Briefing) {
  if (briefing.period === 'WEEKLY') {
    const scopeRange =
      typeof briefing.scope === 'object' && briefing.scope && 'rangeLabel' in briefing.scope
        ? String((briefing.scope as { rangeLabel?: unknown }).rangeLabel ?? '')
        : '';
    if (scopeRange) {
      return scopeRange;
    }
    if (briefing.periodStart && briefing.periodEnd) {
      const start = new Date(briefing.periodStart);
      const end = new Date(new Date(briefing.periodEnd).getTime() - 24 * 60 * 60 * 1000);
      return `${start.toISOString().slice(0, 10)} 至 ${end.toISOString().slice(0, 10)}`;
    }
  }
  return briefing.date.slice(0, 10);
}
```

- [ ] **Step 5: Send period in generate action**

Update `handleGenerate`:

```ts
      const briefing = await api.generateProjectBriefing(selectedProjectId, {
        period,
        date,
        regenerate: true,
      });
      await refresh(selectedProjectId);
      toast.success(period === 'WEEKLY' ? '周报已生成' : '简报已生成');
```

- [ ] **Step 6: Add selector and weekly labels**

In the generate form, add a period select before date:

```tsx
              <div className="flex w-full flex-col gap-1.5 sm:w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">类型</label>
                <Select value={period} onValueChange={(value) => setPeriod(value as BriefingPeriod)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">日报</SelectItem>
                    <SelectItem value="WEEKLY">周报</SelectItem>
                  </SelectContent>
                </Select>
              </div>
```

Update the date label:

```tsx
                <label className="text-xs font-medium text-muted-foreground">
                  {period === 'WEEKLY' ? '周内日期' : '日期'}
                </label>
```

Update the button:

```tsx
                  {generating ? '生成中...' : period === 'WEEKLY' ? '生成周报' : '生成简报'}
```

- [ ] **Step 7: Add history type and range display**

Add a table header after 日期:

```tsx
                    <th className="px-4 py-3 font-medium">类型</th>
```

Update row cells:

```tsx
                      <td className="px-4 py-3">{briefingRangeLabel(briefing)}</td>
                      <td className="px-4 py-3">{periodLabel(briefing.period)}</td>
```

- [ ] **Step 8: Run focused web test**

Run:

```bash
pnpm --filter flowx-web test -- apps/web/src/pages/BriefingsPage.test.tsx
```

Expected: tests pass.

- [ ] **Step 9: Run web build**

Run:

```bash
pnpm --filter flowx-web build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 10: Commit frontend changes**

```bash
git add apps/web/src/types.ts apps/web/src/api.ts apps/web/src/pages/BriefingsPage.tsx apps/web/src/pages/BriefingsPage.test.tsx
git commit -m "feat: 增加手动生成周报入口"
```

---

### Task 8: Full Verification

**Files:**
- Verify all touched backend, frontend, Prisma, and docs files.

- [ ] **Step 1: Run API tests**

```bash
pnpm --filter flowx-api test
```

Expected: all API tests pass.

- [ ] **Step 2: Run Web tests**

```bash
pnpm --filter flowx-web test
```

Expected: all Web tests pass.

- [ ] **Step 3: Run full repository check**

```bash
pnpm check
```

Expected: build and test phases pass.

- [ ] **Step 4: Inspect git status**

```bash
git status --short
```

Expected: only pre-existing unrelated `apps/cursor-extension` user changes remain unstaged, or the working tree is clean aside from those files.

- [ ] **Step 5: Commit any verification-only adjustments**

If verification required small fixes in touched weekly-briefing files, commit them:

```bash
git add prisma/schema.prisma prisma/migrations/20260617090000_weekly_briefings/migration.sql apps/api/src/briefings apps/api/src/prompts/briefing-summary.prompt.ts apps/web/src/types.ts apps/web/src/api.ts apps/web/src/pages/BriefingsPage.tsx apps/web/src/pages/BriefingsPage.test.tsx
git commit -m "test: 补齐项目周报验证"
```

If there are no additional weekly-briefing changes, skip this commit.

---

## Self-Review Notes

- Spec coverage: model fields, natural-week calculation, manual-only generation, daily compatibility, prompt constraints, renderer copy, frontend selector, history display, and tests are each mapped to a task.
- Scope: scheduler and automatic weekly delivery are intentionally not included.
- Type consistency: `BriefingPeriod` is defined in backend DTO and frontend types with the same literal values: `DAILY` and `WEEKLY`.
- Risk focus: high-risk briefing service changes are test-first and verified with focused API tests before broad checks.
