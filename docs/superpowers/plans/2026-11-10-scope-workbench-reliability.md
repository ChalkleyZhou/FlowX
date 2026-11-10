# 提测范围工作台实施计划

> 按 executing-plans 在当前会话顺序执行，先测试后实现。

**目标：** 修复移除/恢复状态链路，落实目录筛选与单列表工作台。

**架构：** 保留现有草稿和补选入口，向后兼容扩展恢复与服务端视图筛选；模块计算留在服务端；Web 容器串行保存，目录和详情拆为独立组件。

**技术：** React、TypeScript、NestJS、Prisma、SQLite、Vitest。

- [x] 在 test-requests.scope.integration.spec.ts 增加真实数据库移除/恢复、CAS、跨项目和完整模块回归，先运行并确认失败。
- [x] 扩展 test-request.dto.ts、controller 和 service，浏览查询拆入 test-request-scope-browse.ts；保留旧接口默认值，候选与 scopeCase 状态在事务内一致更新。
- [x] 重写 QualityScopeDraftPanel.test.tsx，验证刷新后的 UI、撤销、失败回滚、目录不含复选框和详情翻阅，先运行并确认失败。
- [x] 更新 api.ts/types.ts；重构工作台，拆出 QualityScopeDirectory.tsx 和 QualityScopeCaseDetails.tsx；默认范围视图，服务端分页，串行保存与即时反馈。
- [x] 同步 CHANGELOG、README、quality-foundation、用户手册及镜像，记录本地适配和兼容结论。
- [x] 执行受影响测试与构建、pnpm check、手册镜像和差异检查，提交可审阅结果。


## 验证结果

- 真实 HTTP/SQLite 回归 5 项通过：移除与恢复、AI 新用例撤销、revision 冲突、确认后拒绝、跨项目拒绝、105 条含子模块的整模块操作、旧补选请求兼容。
- `pnpm check` 通过：API 161 文件 / 1249 项，Web 60 文件 / 414 项，本地包 29 文件 / 187 项；协议包测试及 API/Web 构建通过。
- 代码复核后补齐旧刷新失败、卸载后排空、保存途中重新挂载及 AI 入库后导航回归，最终 Web 60 文件 / 418 项通过，Web build 通过。
- 浏览器使用隔离的模拟数据验证窄屏与桌面布局、取消即移出、全部用例保持未选及详情连续浏览；未操作运行中业务数据库，临时预览文件和服务已清理。
- 两份手册源文件与镜像一致，`git diff --check` 通过。
- 本地适配结论：复用现有能力，不新增 MCP/CLI/Skill/Adapter 或共享协议字段；Web/API 配套部署，未发布 npm 包。
