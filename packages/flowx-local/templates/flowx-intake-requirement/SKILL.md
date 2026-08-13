---
name: flowx-intake-requirement
description: FlowX 本地需求发起：列出项目、创建需求、确认后启动工作流，并可选择进入产品构思。Use when the user wants to create a new FlowX requirement or start a requirement from local AI tools.
---

# FlowX 本地需求发起

在 Cursor / Codex + FlowX MCP 中，从零创建需求并启动工作流。平台以查看与确认门禁为主；本 Skill 是推荐发起路径。

## 何时使用

- 用户要新建 / 发起 FlowX 需求，且还没有应优先 bind 的既有工作流
- 若已有候选工作流：先 `flowx_list_tasks`，确认后 `flowx_bind_workflow`，不要重复创建

## 必须流程

1. **选项目**  
   调用 `flowx_list_projects`，向用户展示工作区/项目列表（可附一句推荐），**必须等用户选定** `projectId`。  
   禁止用本地目录或 git remote 猜测项目。

2. **收齐字段**  
   - 必填：`title`、`description`  
   - `acceptanceCriteria`：API 必填；用户未给时用一两句可观察结果占位，并在启动摘要标明「占位，可后续在 Web 改」  
   - `repositoryIds`：可选；不选则继承平台默认

3. **创建**  
   调用 `flowx_create_requirement`。成功后回显 `requirementId`、标题、项目。  
   创建前不强制二次确认；标题/描述含糊时先问清再调用。

4. **启动确认（硬门禁）**  
   创建成功后立刻进入启动，但先展示摘要再调工具：  
   - 需求标题与 id  
   - 仓库范围  
   - AI 执行器（`codex` / `cursor`，若用户有偏好）  
   - 选项：**启动并进入构思** / **仅启动，暂不构思**  
   仅当用户明确选择后，以 `userConfirmedStart: true` 调用 `flowx_start_workflow`。  
   禁止在未确认时启动。

5. **启动后分支**  
   - **进入构思：** `flowx_bind_workflow`（stage=`brainstorm`）→ 按 `flowx-product-prd` 继续（handoff → `prd.md` → 确认后 submit）  
   - **暂不构思：** 告知可在 Web 查看，或稍后 `flowx_list_tasks`；结束，不写 `prd.md`

## 禁止

- 未确认即 `flowx_start_workflow`
- 把聊天记录原样当需求正文
- 在本 Skill 内提交 `prd.md` / `design.md`
- 启动失败时宣称已启动
- 自动删除已创建但未启动的需求

## 失败处理

- 创建失败：不进入启动  
- 已创建、启动失败：保留 `requirementId`，引导再次确认后重试启动，或回 Web 启动
