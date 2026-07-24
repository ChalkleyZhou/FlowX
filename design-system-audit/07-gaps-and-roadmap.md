# 缺口与路线图

## P0：阻断级

| 问题 | 证据 | 动作 | 收益 | 粗估 |
| --- | --- | --- | --- | --- |
| 无统一服务端分页 | 多数 API helper 返回数组；后端 `findMany` 无 `skip/take/count` | 定义 `PageResult<T>`，先改造工作流、需求、问题、缺陷 | 性能可控，结果可分享 | 1-2 周 |
| 筛选状态不可恢复 | Issue/Bug 使用 React state；工作流仅部分筛选在 URL | 统一 URL query + 用户级偏好 hook | 刷新、返回、分享可靠 | 3-5 天 |
| 工作流主动作不突出 | `WorkflowRunDetailPage.tsx` 集中多个阶段动作和状态分支 | 当前阶段唯一主动作 + sticky ActionBar | 降低误操作，缩短完成路径 | 1 周 |
| 规范和代码漂移 | 文档蓝色/Avenir；代码黑色/Inter | 确认视觉 source of truth 并同步 | 避免持续产生两套界面 | 1-2 天 |

已有视觉治理的 quick wins 仍然有效：清理共享组件外的任意阴影/圆角覆盖，并为 Button/Input/Select/Badge 补 loading、error、disabled 和 icon-only 状态测试。

## P1：近期提升

| 问题 | 动作 | 收益 |
| --- | --- | --- |
| 首屏没有待办导向 | 增加我的工作队列 | 从“找数据”转成“完成工作” |
| 工作流长页面 | 拆当前阶段、变更与审查、上下文、历史 | 保持上下文同时降低滚动成本 |
| 反馈状态不完整 | 统一 skeleton、局部 loading、失败恢复、更新时间 | 用户知道系统是否在工作 |
| 状态文案分散 | 建立 StatusBadge 和动作能力映射 | 状态理解一致 |

## P2：长期治理

- 保存筛选视图和订阅异常。
- 项目健康视图串联需求、工作流、质量和排期。
- 角色化导航和队列。
- 视觉回归、无障碍和列表性能预算。
- 将 token 转成可导入的 DTCG 文件，由 CSS/TS/Tailwind 生成。
- 引入组件文档或 Storybook，记录 variants、states、禁用场景和可访问性要求。
