# 产品构思改为 PRD 头脑风暴设计

**Date:** 2026-07-27  
**Status:** Approved for planning  
**Scope:** 将本地「产品构思」从 Superpowers/OpenSpec 风格的 `spec.md`，改为面向产品经理/设计师的精简 PRD 流程：先头脑风暴澄清，再产出确认后的 `prd.md` 回传平台。

## Goal

产品构思阶段只澄清**产品需求**，产出给 **产品经理 / 设计师** 阅读确认的文档；不写实现细节，也不再以 Superpowers / OpenSpec / `spec` 作为主叙事。

## Decisions

| 主题 | 选择 |
| --- | --- |
| 过程 | 必须先多轮头脑风暴澄清，再写正式文档 |
| 产物文件名 | `prd.md` |
| 文档结构 | 精简产品向（见下）；不含技术实现章 |
| 读者 | 产品经理、设计师（及确认需求的业务方） |
| Skill | 新 Skill `flowx-product-prd` 替换主路径 `flowx-brainstorm-spec` |
| 参考系 | 专业 PRD 写法；**不**参考 Superpowers/OpenSpec |
| 技术细节 | Soft + 允许/禁止清单；不写进 `prd.md` 正文 |
| 硬拦截关键词 | 不做（本变更） |
| 云端 `runBrainstorm` | 本变更不同步（可选 follow-up） |
| API | `flowx_submit_brainstorm` 契约不变（markdown 字符串） |

## User flow

1. 用户在工作流「产品构思」打开本地构思（OpenDesign / Cursor）  
2. Agent 经 MCP 拉上下文  
3. **多轮头脑风暴**：目标用户、问题、场景、边界、怎样算做成；未澄清够不写正式 PRD  
4. 写入 **`prd.md`**（精简产品向章节）  
5. 全文展示给用户确认  
6. 确认后 `flowx_submit_brainstorm`，平台展示为产品需求 / PRD，进入设计阶段  

## `prd.md` structure

- 背景与问题  
- 目标用户  
- 目标 / 非目标  
- 用户故事与核心场景  
- 产品规则与边界情况  
- 验收标准（用户可感知的产品结果）  
- 仍开放的产品问题（优先在对话中关闭）  

## Content boundaries

**允许：** 用户、场景、流程、业务规则、边界、可观察的验收结果、产品开放问题。  

**禁止写入正文：** API/协议字段、库与框架名、数据库与表结构、系统架构与模块拆分、组件/中间件实现方式。  

技术点对话中可记「留给设计/技术方案」；用户坚持的存量约束只用一句产品语言转述（如「需对接现有登录」），不写实现。

## Skill & setup

- 模板：`packages/flowx-local/templates/flowx-product-prd/SKILL.md`  
- 安装名：`flowx-product-prd`（`~/.cursor/skills/...`、`~/.agents/skills/...`）  
- `flowx-local setup` 安装新 Skill；默认不覆盖用户已改文件，`--force` 才覆盖  
- 旧 `flowx-brainstorm-spec`：文档标明弃用；setup 不强制删除用户本机旧目录  

Skill 必须写清：头脑风暴 → `prd.md` → 确认 → submit；读者与允许/禁止清单；MCP 工具名；**禁止**引导 Agent 按 Superpowers/OpenSpec/`spec.md` 写。

## Compatibility

Adapter / `design-submit` 读取顺序：

1. `prd.md`（主）  
2. `spec.md`（过渡）  
3. `brainstorm.md`（遗留）  

Handoff `resultFileName` → `prd.md`。MCP tool 描述改为 PRD / `prd.md`。OpenDesign `INSTRUCTIONS.md` 对齐新流程。

## Platform copy & docs

- Web toast / 引导：「产品规格 / spec」→「产品需求 / PRD」；流程文案含头脑风暴  
- `docs/user-manual.md`、`docs/local-agent-guide.md` 及 `apps/web/public` 镜像  
- 相关 OpenDesign / edge 文档中构思路径说明  

## Non-goals

- 新工作流状态或新 HTTP/MCP 完成接口  
- 关键词硬校验拒绝提交  
- 本变更内同步云端 AI `runBrainstorm` prompt  
- 强制删除用户已安装的旧 Skill 文件  
- 完整企业级 PRD（价值主张、OKR、Release 规划等）——刻意保持精简  

## Testing

- `setup`：安装到 `flowx-product-prd`；内容含头脑风暴与 `prd.md`  
- OpenDesign adapter：优先 `prd.md`；仍可读 `spec.md` / `brainstorm.md`  
- MCP 描述/相关测试字符串更新  
- 文档镜像 `cmp`  

## Migration note for users

已装旧 Skill 的用户需执行：

```bash
flowx-local setup --force
```

才切换到 `flowx-product-prd`；否则可能仍命中本机旧的 `flowx-brainstorm-spec`。

## Risks

- Soft Skill 约束仍可能写出技术味内容；硬门禁留给后续  
- 仅 `--force` 才覆盖时，部分用户会短期新旧混用——靠文档与 setup 提示缓解  
