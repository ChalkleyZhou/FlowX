---
name: flowx-intake-requirement
description: FlowX 本地需求发起：列出项目、确认发布版本、创建需求、确认后启动工作流，并可选择进入产品构思。Use when the user wants to create a new FlowX requirement or start a requirement from local AI tools.
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

2. **确认发布版本（硬门禁）**
   展示该项目的 `currentVersion`（没有则明确说「当前无版本」）以及 `versions` 列表，**必须等用户选择**后再创建需求：
   - 有当前版本：选项为 **用当前版本** / **新建版本**
   - 无当前版本：选项为 **新建版本** / **本需求暂不挂版本**
   - 用户点名已有版本名（如 `2.5.0`）：用已有 `id`，不要新建
   - 选「新建版本」：先问名称，再调用 `flowx_create_project_version`（`setAsCurrent: true`），后续需求挂到返回的 id
   禁止未展示当前版本就创建；禁止省略 `versionId` 依赖服务端默认；禁止未确认就把新建版本设为当前；禁止用本地目录猜版本。

3. **收齐字段**
   - 必填：`title`、`description`
   - `acceptanceCriteria`：API 必填；用户未给时用一两句可观察结果占位，并在启动摘要标明「占位，可后续在 Web 改」
   - `repositoryIds`：可选；不选则继承平台默认

4. **创建**
   调用 `flowx_create_requirement`，**必须传入**用户确认的 `versionId`（具体 id 或 `null`）。
   成功后回显 `requirementId`、标题、项目、版本名（未挂则说明未挂版本）。
   标题/描述含糊时先问清再调用。

5. **启动确认（硬门禁）**
   创建成功后立刻进入启动，但先展示摘要再调工具：
   - 需求标题与 id
   - 发布版本
   - 仓库范围
   - AI 执行器（`codex` / `cursor`，若用户有偏好）
   - 选项：**启动并进入构思** / **仅启动，暂不构思**
   仅当用户明确选择后，以 `userConfirmedStart: true` 调用 `flowx_start_workflow`。
   禁止在未确认时启动。

6. **启动后分支**
   - **进入构思：** `flowx_bind_workflow`（stage=`brainstorm`）→ 按 `flowx-product-prd` 继续（handoff → `prd.md` → 确认后 submit）
   - **暂不构思：** 告知可在 Web 查看，或稍后 `flowx_list_tasks`；结束，不写 `prd.md`

## 禁止

- 未展示并确认发布版本即 `flowx_create_requirement`
- 省略 `versionId` 靠服务端默认当前版本
- 未确认即 `flowx_start_workflow`
- 把聊天记录原样当需求正文
- 在本 Skill 内提交 `prd.md` / `design.md`
- 启动失败时宣称已启动
- 自动删除已创建但未启动的需求

## 失败处理

- 创建失败：不进入启动
- 已创建、启动失败：保留 `requirementId`，引导再次确认后重试启动，或回 Web 启动
