# 项目工作项标签实施计划

> 执行方式：按照任务拆分实现，使用独立审查与完成前验证；以下复选项记录实际完成状态。

**目标：** 实现项目级标签管理、三类工作项多选与筛选，并同步本地 MCP 能力。

**架构：** `@flowx-ai/protocol` 提供颜色、名称和标签 ID 输入的纯运行时校验；API 的 `ProjectLabelsService` 集中执行项目归属与标签 CRUD，工作项事务复用其规则；Web 共享管理、选择和徽标组件，MCP 只桥接现有 API。数据库使用 `ProjectLabel` 和显式 `WorkItemLabel` 关联。

**技术栈：** TypeScript、NestJS、Prisma/SQLite、React、Radix、Vitest、pnpm。

设计基线：`docs/superpowers/specs/2026-11-23-project-work-item-labels-design.md`。本地适配结论为“需要适配”；不改变执行项状态机。

## 任务 1：共享契约与输入边界

文件：`packages/flowx-protocol/src/project-labels.ts`、`project-labels.test.ts`、`index.ts`、`work-items.ts`。

- [x] 先写行为测试并运行 `pnpm --filter @flowx-ai/protocol test`，确认尚无导出导致失败。
- [x] 实现 `PROJECT_LABEL_COLORS`、`ProjectLabelColor`、`ProjectLabelSummary`、`normalizeProjectLabelName`、`parseProjectLabelIds`、`parseProjectLabelFilter`。输入非法时抛出普通 `Error`，API 包装成 400，MCP 复用相同规则。
- [x] 名称执行 trim/NFC，拒绝控制字符和换行，按码点校验 1–30 长度；ID 数组去重后最多 20，拒绝 null、非数组、空 ID；查询接受逗号分隔字符串。
- [x] 回归断言：`expect(parseProjectLabelIds([])).toEqual([])`；`expect(() => parseProjectLabelIds(null)).toThrow()`；`expect(normalizeProjectLabelName(' 前端 ')).toBe('前端')`。
- [x] 增量导出与可选 `WorkItemRef.labels`，运行 protocol test/build。

## 任务 2：数据库、项目标签 API 与工作项关联

文件：`prisma/schema.prisma`、`prisma/migrations/20261123090000_project_work_item_labels/migration.sql`、`apps/api/src/projects/project-labels*`、`projects.module.ts`、`apps/api/src/work-items`、`apps/api/src/prisma/organization-scope*`。

- [x] 先补标签校验、CRUD、项目隔离、并发/回滚与工作项读写的测试，运行受影响 API spec 确认失败。
- [x] 新增标签表及关联表，唯一键 `(projectId,nameKey)` 和 `(workItemId,labelId)`，按设计添加排序与反查索引、外键级联；运行 `pnpm prisma:generate`。
- [x] 实现项目标签分页、创建、编辑、删除及集中归属校验。新路由采用 `projects/:projectId/labels`；组织隔离需同时注册两个模型。
- [x] 创建与更新工作项事务接收 `labelIds`；更新省略保留、空数组清空、非空整体替换，CAS 与关联变更一起提交。旧测试 mock 未提供事务时不得绕过实际生产事务。
- [x] 列表和详情统一返回 `labels` 摘要，列表使用 OR 标签条件与其他筛选取交集，数量和数据使用同一个 where。
- [x] 新增回归：跨项目标签拒绝且其他字段不保存；旧客户端仅改标题保留标签；已删除标签提交失败；同项目名称忽略大小写重复返回 409。
- [x] 运行 API test/build，检查 Docker 的 additive migration 无需额外历史回填。

## 任务 3：Web 管理与共享标签组件

文件：`apps/web/src/components/ProjectLabelsPanel.tsx`、`ProjectLabelSelect.tsx`、`ProjectLabelBadges.tsx`、标签管理对话框及测试，`pages/ProjectDetailPage.tsx`、`api.ts`、`types.ts`、`globals.css`。

- [x] 先写设置页标签管理、空/错误状态、多选草稿和 API 请求测试并确认失败。
- [x] 设置页增加版本/标签/简报/代码审查页签，`tab=labels` 可深链，保留旧版本锚点和项目范围。
- [x] 标签管理表格提供名称搜索、20 条分页、使用数量、新建/编辑颜色预览、删除确认和错误保留。
- [x] 共享选择器接收 `projectId/value/onChange` 和已选摘要，搜索分页保留已选，支持清空、键盘、刷新和新窗口管理；标签徽标支持两个折叠及完整名称提示，预置颜色映射兼容深色主题。
- [x] 测试验证重复名称、服务失败不丢草稿、项目切换清空、分页搜索不清除已选项；运行 Web test/build。

## 任务 4：所有工作项入口与特殊创建链路

文件：`VersionWorkItemsPage.tsx`、`WorkItemEditDialog.tsx`、`WorkItemDetailPage.tsx`、`RequirementsPage.tsx`、`RequirementEditDialog.tsx`、`RequirementListTable.tsx`、`IssuesPage.tsx`、`BugsPage.tsx`、`BugDetailPage.tsx`；API `review-artifacts`、`prototype-imports` 与上下文消费者。

- [x] 测试先覆盖三类型标签回填、创建请求、取消/失败保留、筛选 URL 与列表统计、缺陷专用接口和原型 ZIP。
- [x] 按设计接入新建/编辑/详情元信息以及所有列表标签列，列表筛选明确“匹配任一标签”；查询按钮与 URL 语义复用现有实现。
- [x] `/bugs` 创建/编辑/读取/筛选复用集中校验，保留缺陷专属字段；原型 ZIP 创建时原子保存标签，自动生成工作项缺省无标签。
- [x] 增加本地执行上下文标签摘要，保持执行项领取/回传与工作流控制不受影响。
- [x] 运行受影响 API/Web 测试和构建。

## 任务 5：本地 MCP 桥接与兼容

文件：`packages/flowx-local/src/mcp.ts`、`mcp.test.ts`，以及 `templates` 内新建/编辑工作项说明。

- [x] 先写 MCP 工具发现、查询 URL、创建/更新请求体及旧服务端失败测试，确认失败。
- [x] 新增 `flowx_list_project_labels`，支持 `projectId/page/pageSize/q`；扩展 `flowx_create_work_item`、`flowx_update_work_item`、`flowx_list_version_work_items` 的 `labelIds` schema 与请求映射。
- [x] 用 `labelIds !== undefined` 判断发送，确保 `[]` 不被 truthy/length 分支丢弃；只有明确路由不存在才提示服务端不支持标签，不吞权限或网络错误。
- [x] 旧响应缺字段时保留旧行为，但明确要求标签的操作不得伪报成功；工具描述说明需先查询已有标签，管理写入由 Web 完成。
- [x] 运行 local/protocol test/build，并核对真实工具到 HTTP 请求和响应。

## 任务 6：文档、集成验证与审查

文件：`README.md`、`CHANGELOG.md`、`docs/user-manual.md`、`docs/local-agent-guide.md`、两份 public 手册镜像、`docs/system-design.md`、`docs/architecture/ai-maintainability.md`、相关运维/本地指南。

- [x] 同步标签管理位置、多选/删除/筛选语义、本地工具范围、兼容升级和能力限制；更新本计划状态。
- [x] 运行 `pnpm check`，以及根 check 未涵盖的 local/protocol build；执行两份 `cmp -s` 与 `git diff --check`。
- [x] 使用本地隔离数据库与浏览器检查标签管理、创建编辑、筛选、深色/键盘；不得修改用户运行数据库或线上数据。
- [x] 独立审查规格覆盖、事务/隔离/空值语义与所有消费者，修复高优先级问题后复验。
- [x] 仅提交本次功能及对应 CHANGELOG；不推送、不发布 npm、不部署，除非用户另行要求。

## 交付与验证记录（2026-11-23）

- 已完成共享契约、数据库与 API、Web 全部创建/编辑/详情/列表入口、本地 MCP 和文档适配；已合并到 `main`，并完成 npm 包版本发布准备。
- 本地适配结论：**需要适配，已交付源码**。MCP 增加标签分页查询，以及现有创建、更新、版本列表的标签参数透传；上下文携带摘要，CLI 与执行控制复用现有能力，不新增标签管理写入入口。旧请求省略字段保持兼容；服务端缺能力或写入结果无法确认时明确报错。已发布 `@flowx-ai/protocol@0.8.0` 与 `@flowx-ai/local@0.9.0`。
- 全仓验证：`npm_config_workspace_concurrency=1 pnpm check` 通过，覆盖构建与 2,133 条测试（工具包 77、protocol 20、API 1,315、Web 474、local 247）；另行完成 local build。设置项目串行执行以避免多个子项目同时运行时的资源竞争，未放宽测试超时或跳过测试。
- 独立临时数据库的真实 HTTP 验证通过：24 项标签功能检查，以及缺陷专属 CAS 和完整筛选集统计检查。迁移在隔离数据库副本执行通过，原工作项保留、外键有效、默认颜色为 `BLUE`；用户运行数据库未修改。
- 真实 MCP 客户端连接本地工具后访问隔离 HTTP API，验证工具发现、标签查询、创建绑定、版本筛选和空数组清空，无 HTTP mock。
- 浏览器验收通过：项目设置深链与新建/选色、需求多选创建、编辑回填与清空、查询提交与 URL、浅色/深色展示、Escape 仅关闭标签面板并保留标题及已选标签。主题已恢复验收前设置。
- 独立审查发现的专属编辑 CAS、晚到响应覆盖筛选草稿、分页统计遗漏均已修复并复核；真实浏览器发现的 Escape 父窗口关闭问题已补真实 Radix 嵌套回归并复验。
- 文档与两份公开手册镜像保持一致，`git diff --check` 通过。原型 ZIP 的标签原子保存、失败回滚及 multipart 请求通过 API 测试验证；本轮未使用真实在线 AI 凭据触发原型分析，未部署服务端。
