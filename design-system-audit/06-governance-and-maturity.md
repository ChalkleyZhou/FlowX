# 治理与成熟度

| 维度 | 评级 | 依据 |
| --- | --- | --- |
| Token source of truth | Medium | `globals.css` 和 `design-tokens.ts` 同步维护，当前生效设计文档已对齐；仍缺少自动漂移检查 |
| Component ownership | Medium | 基础组件位于 `components/ui`，业务组件位于 `components`，边界清楚 |
| Interaction patterns | Low | 分页、列表查询、筛选持久化和工作流动作没有公共实现 |
| Documentation | Medium | 有 `apps/web/docs/design-system.md` 作为 Web 唯一日常规范，并有 AGENTS 约束；仍缺少完整组件状态文档 |
| Versioning | Unknown | 未发现独立 design system 版本策略 |
| Adoption measurement | Low | 未发现 lint、扫描或测试来保证页面采用公共组件和 token |
| Quality gates | Medium-Low | 有前端测试和 build 命令，但没有统一视觉回归、无障碍和列表性能门禁 |

当前目标成熟度为 4/5：token 变更有单一入口，组件状态有文档，核心页面有桌面/窄屏截图回归，新增页面通过 lint/test/build 和可访问性检查。

## 建议治理规则

1. 保持 `globals.css` + `design-tokens.ts` 为 token source of truth，并在 CI 中检查漂移；`apps/web/docs/design-system.md` 只记录使用规则。
2. 每个业务状态建立唯一文案和颜色映射，页面不得直接拼状态字符串。
3. 新列表必须使用统一查询 hook 和分页组件；评审模板中加入 URL 恢复、空态和错误态检查。
4. 工作流状态机的后端枚举、前端展示映射、动作能力和测试应保持同一份契约。
5. 关键工作流路径增加浏览器测试和桌面截图基线。
