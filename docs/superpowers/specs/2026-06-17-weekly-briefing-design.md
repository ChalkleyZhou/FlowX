# 手动自然周项目变化周报设计

## 背景

当前项目简报支持按项目和日期手动生成“项目变化简报”，并可通过配置在每天固定时间自动生成和投递。简报的数据来源是项目工作区下已登记的 GitLab/GitHub 事件，首要事实来源仍是 commit。

用户希望在现有简报功能上增加周报总结能力。首版只做手动生成，不引入定时周报、自动投递配置或新的简报频道。

## 目标

- 支持用户在简报页手动生成项目周报。
- 周报按北京时间自然周统计：周一 00:00 到下周一 00:00。
- 用户选择周报时，日期表示“该日期所在自然周”，后端统一归一为周一到周日。
- 周报复用现有简报历史、详情展示、投递和 delivery log 能力。
- 日报现有行为保持兼容；未传周期时继续生成日报。

## 非目标

- 不做每周自动生成或自动发送。
- 不增加新的投递目标类型。
- 不从需求、Bug、Issue、Pipeline、Release 或人工备注中推断周报结论。
- 不生成 commit 无法证明的测试结果、上线状态、业务价值、风险判断或排期影响。
- 不为周报新建完全独立的页面体系。

## 方案选择

采用“在现有 `Briefing` 体系中增加周期语义”的方案。

备选方案一是新建 `WeeklyBriefing` 模型。它隔离性强，但会复制历史列表、详情、投递、AI fallback 和日志逻辑，MVP 阶段成本偏高。

备选方案二是不落库、只临时返回周报内容。它实现最快，但无法历史追踪、无法重新查看，也不符合 FlowX 对可追踪研发流程的定位。

推荐方案是在 `Briefing` 模型和生成链路中显式增加 `period`、`periodStart`、`periodEnd`。这样日报和周报共享简报基础设施，同时能避免相同项目、相同日期下日报和周报的唯一性冲突。

## 数据模型

`Briefing` 增加周期字段：

```prisma
model Briefing {
  period      String   @default("DAILY")
  periodStart DateTime?
  periodEnd   DateTime?
}
```

字段含义：

- `period`：`DAILY` 或 `WEEKLY`。
- `periodStart`：该简报统计窗口开始时间，使用 UTC 存储。
- `periodEnd`：该简报统计窗口结束时间，使用 UTC 存储，查询时采用左闭右开。

兼容策略：

- 旧数据默认视为 `DAILY`。
- 日报可以把 `periodStart`、`periodEnd` 写为现有 cutoff day 窗口，便于后续统一展示和排查。
- `scopeKey` 纳入 `period`、`periodStart`、`periodEnd`，保证同一个项目的日报和周报不会互相覆盖。

## 时间窗口

新增自然周窗口工具：

```ts
briefingWeekWindow(date: string): {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
}
```

规则：

- 输入 `date` 是 `YYYY-MM-DD`，按 `Asia/Shanghai` 解释。
- `startDate` 是该日期所在自然周的周一。
- `endDate` 是该自然周的周日，用于标题展示。
- `start` 是北京时间周一 00:00 转换后的 UTC 时间。
- `end` 是北京时间下周一 00:00 转换后的 UTC 时间。

周报不使用日报的 `dailyHour` cutoff。日报继续使用现有 `briefingDateWindow(date, cutoffHour)`。

## API

`GenerateBriefingDto` 增加周期参数：

```ts
export class GenerateBriefingDto {
  period?: 'DAILY' | 'WEEKLY';
  date?: string;
  regenerate?: boolean;
}
```

行为：

- `period` 缺省为 `DAILY`。
- `DAILY` 维持当前行为。
- `WEEKLY` 使用自然周窗口。
- `date` 对周报表示“周内任意日期”。
- `regenerate: true` 重新生成同一项目、同一周期、同一 scope 的简报，并清空既有 `sentAt`。

现有接口路径保持不变：

```http
POST /projects/:id/briefings/generate
GET /projects/:id/briefings
GET /briefings/:id
POST /briefings/:id/send
```

`GET /projects/:id/briefings` 返回值包含 `period`、`periodStart`、`periodEnd`，前端用于历史表展示类型和周期。

## 生成流程

生成服务按周期解析窗口：

1. 读取项目、工作区仓库和启用的数据源。
2. 解析 `period`。
3. 日报生成现有日期窗口；周报生成自然周窗口。
4. 用 `period`、日期标签、窗口、项目、仓库和数据源生成 `scopeKey`。
5. 查找同 scope 的既有简报；非 `regenerate` 时直接返回。
6. 查询窗口内的 `BriefingEvent`。
7. 调用 AI summarizer 或 fallback。
8. 渲染 Markdown 和 HTML。
9. 创建或更新 `Briefing`。

周报和日报共享同一事件归一化与 commit 收集逻辑。周报首版不做按天拆分，以避免 UI 和 prompt 过重；正文仍按主题聚合，并在研发记录中保留 commit 依据。

## AI 总结

`BriefingAiSummarizerService.summarize` 输入增加周期上下文：

```ts
interface SummarizeInput {
  period: 'DAILY' | 'WEEKLY';
  date: string;
  rangeLabel: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
}
```

prompt 从“一天的 commit”泛化为“一个周期的 commit”。周报 prompt 仍遵守当前事实约束：

- commit 是唯一事实来源。
- topic 必须引用真实 commit。
- `modules` 只能来自 repository 或 commit scope。
- 信息缺口放入 `openQuestions`。
- 禁止虚构上线、验收、测试、风险、排期和业务价值。

fallback 文案按周期区分：

- 日报无 commit：`今日暂无可归纳的项目变化。`
- 周报无 commit：`本周暂无可归纳的项目变化。`
- 周报有 commit 但无法归纳：`本周共记录 N 次提交，现有信息不足以形成可靠的项目变化主题。`

## 渲染

渲染输入增加周期上下文：

```ts
interface RenderInput {
  period: 'DAILY' | 'WEEKLY';
  date: string;
  rangeLabel: string;
  projectName: string;
  events: NormalizedBriefingEvent[];
  rawPayloadByEventIndex?: unknown[];
  aiSummary?: BriefingAiSummary;
}
```

标题：

- 日报：`项目名 · 项目变化简报 · 2026-06-17`
- 周报：`项目名 · 项目变化周报 · 2026-06-15 至 2026-06-21`

日报正文保持当前结构：

```md
## 今日概览
## 主要变化
## 待确认事项
## 研发记录
```

周报正文：

```md
## 本周概览
## 主要变化
## 待确认事项
## 研发记录
```

HTML 渲染与 Markdown 使用同一语义。

## 前端交互

在 `BriefingsPage` 的“生成简报”区域增加周期选择：

- `日报`
- `周报`

选择日报：

- 日期 label：`日期`
- 按钮：`生成简报`
- payload：`{ period: 'DAILY', date, regenerate: true }`

选择周报：

- 日期 label：`周内日期`
- 按钮：`生成周报`
- payload：`{ period: 'WEEKLY', date, regenerate: true }`
- 成功提示：`周报已生成`

历史表增加“类型”列：

- `DAILY` 显示 `日报`
- `WEEKLY` 显示 `周报`

历史表日期列对周报展示自然周范围，例如 `2026-06-15 至 2026-06-21`。详情页继续复用现有 Markdown 展示和发送按钮。

## 错误处理

- 非法 `period` 由 DTO 校验拒绝。
- 非法日期沿用 `IsDateString` 校验。
- 找不到项目、无数据源、无事件时仍按现有方式返回可查看的空简报，不视为异常。
- AI 总结失败时继续 fallback，不影响周报生成。
- 投递失败仍写入 delivery log，行为与日报一致。

## 测试

后端测试：

- `briefing-time-window` 覆盖自然周窗口：
  - 周一输入。
  - 周日输入。
  - 跨月自然周。
  - 跨年自然周。
- `BriefingsService` 覆盖：
  - 未传 `period` 时保持日报行为。
  - 周报查询完整自然周事件。
  - 同一项目同一日期的日报和周报不会命中同一 `scopeKey`。
  - 周报重复生成返回既有记录。
  - 周报 `regenerate` 更新内容并清空 `sentAt`。
- renderer 覆盖：
  - 周报标题。
  - `本周概览`。
  - 周报无 commit fallback。
- prompt 覆盖：
  - 周报 prompt 不再写死“一天”。
  - 事实约束仍保留。

前端测试：

- `BriefingsPage` 选择周报后调用 `generateProjectBriefing(projectId, { period: 'WEEKLY', date, regenerate: true })`。
- 周报按钮、日期 label 和成功提示正确。
- 历史表能展示日报和周报类型。

## 交付顺序

1. 增加 Prisma 字段和迁移，生成 Prisma client。
2. 增加周期类型和自然周窗口工具及测试。
3. 更新 DTO、service、scopeKey 和生成流程测试。
4. 更新 AI facts/prompt/summarizer 和 fallback 文案。
5. 更新 Markdown/HTML renderer。
6. 更新前端类型、API payload 和简报页交互。
7. 运行 API 和 Web 测试，最后运行 `pnpm check`。

## 验收标准

- 用户可以在简报页选择“周报”，选择周内任意日期后生成该自然周周报。
- 周报详情可查看 Markdown 内容，可沿用现有投递功能发送。
- 日报生成、历史查看和定时日报不受影响。
- 同一项目同一日期可以同时存在日报和周报。
- 周报不会输出 commit 无法证明的结论。
- API 和 Web 相关测试通过。
