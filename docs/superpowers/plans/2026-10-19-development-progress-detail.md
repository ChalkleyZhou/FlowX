# 开发进展详情可读性调整

**目标：** 修正看板“查看进展”仍复用旧运行面板的问题，围绕当前进展、最近进展记录和开发结果组织只读详情，明确本地回报与核验状态的含义。

**范围：** 调整独立详情及其专用展示组件，事件查询增加向后兼容的 `view=progress`；工作流中的执行控制面板保持原有用途。

- [x] 先补页面回归：进展正文与时间、检查点不冒充进展、分类结果与回报/核验标签、空结果解释、技术信息默认折叠、读取失败保留主体及重试。
- [x] 新增 `DevelopmentProgressDetail.tsx`，展示当前进展、最近同步的实质进展、按类型分组的开发结果（提交、文件、测试、构建、摘要、分支检查、人工确认）。展示已有分支、SHA、推送标记、文件路径；不推测测试结果。
- [x] 详情移除 `ExecutionSessionPanel`，顶部保留刷新和返回看板；最近记录合并独立 `latestProgress`，避免被近期心跳挤掉。设备、检查点与运行标识折叠到技术信息。加载失败保留已有信息并提示重试。
- [x] 同步 README、用户手册及镜像；运行 Web 定向红绿测试、全仓检查、文档一致性检查和示例数据浏览器检查。

**验证命令：** `pnpm --filter flowx-web test src/pages/ExecutionSessionsPage.test.tsx`；`npm_config_workspace_concurrency=1 pnpm check`；`git diff --check`；两组手册镜像 `cmp`。

- [x] 审查修正：事件接口先排除心跳和产物事件再分页；真实 SQLite 覆盖 101 条心跳、实质进展跨页、组织拒绝及原查询兼容。非法视图拒绝，Web API helper 同步透传。

## 验证结果

- 定向回归先确认旧详情缺失进展/分类展示、事件筛选参数缺失和心跳挤占后修复；API 17 项、Web API/页面 39 项通过。
- `npm_config_workspace_concurrency=1 pnpm check` 通过：API 723、Web 195、本地包 163、Cursor Extension 78、协议包 13，共 1172 项测试；全仓构建通过。
- 独立审查发现的心跳挤占进展历史已改为服务端先筛选再分页，真实 SQLite 复现和复核通过，无剩余 P1/P2。
- 使用隔离示例数据在浏览器检查新版详情、文件展开、技术信息展开/默认折叠以及 390px 窄屏；无横向溢出，未使用生产数据。
- README、系统设计和用户手册/镜像同步，`git diff --check` 和两组手册 `cmp` 通过。
- 改动位于 `codex/progress-detail`，未提交、推送或部署。
