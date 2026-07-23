# 缺口与路线图

## Quick wins

- **P0** 清理共享组件外的 `shadow-[...]` 和任意圆角覆盖，避免基础 token 被页面反向覆盖。收益：所有页面的边界和密度稳定。
- **P0** 为 Button/Input/Select/Badge 增加 loading、error、disabled 和 icon-only 的示例测试。收益：关键操作状态完整。
- **P1** 统一表格标题、行高、空状态和错误状态。收益：简报、Code Review、交付目标等数据页更易扫描。

## Near-term

- **P1** 建立 `PageTemplate`、`DetailTemplate`、`WorkflowTemplate` 三个布局组合，减少 page 内重复 class。
- **P1** 增加 Playwright 截图基线，覆盖 `/projects`、`/requirements`、`/workflow-runs`、`/schedule` 的 1440/1024/390 宽度。
- **P1** 增加 axe/contrast 检查，特别验证深色导航、状态徽标和 disabled 文本。

## Long-term

- **P2** 将 token 转成可导入的 DTCG 文件，并由 CSS/TS/Tailwind 生成，消除同步成本。
- **P2** 引入组件文档或 Storybook，记录 variants、states、禁用场景和可访问性要求。
- **P2** 建立组件变更日志和采用度统计，作为前端交付质量门槛。
