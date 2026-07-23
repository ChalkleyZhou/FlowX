# 治理与成熟度

| 维度 | 等级 | 证据与判断 |
| --- | --- | --- |
| Token source of truth | Medium | 有 CSS/TS token，但过去存在缺失文档和页面覆盖 |
| Component ownership | Medium | `components/ui` 与业务组件边界已存在 |
| Documentation | Low → Medium | 原声明文档缺失，本次补齐 `DESIGN.md` 和审计包 |
| Versioning | Low | 未发现 token/component 版本策略 |
| Release quality gate | Medium | 有 build/test 约束，缺少视觉回归和 contrast gate |
| Adoption | Low | 旧页面存在大量硬编码圆角、阴影和颜色 |

目标成熟度为 4/5：token 变更有单一入口，组件状态有文档，核心页面有桌面/移动截图回归，新增页面通过 lint/test/build 和可访问性检查。
