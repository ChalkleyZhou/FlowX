# 项目/需求发布版本 — 设计规格

**日期：** 2026-08-13  
**状态：** 已确认  
**范围：** 为项目维护发布版本清单与当前版本，需求最多挂一个版本；覆盖数据模型、API、本地 intake Skill/MCP、Web 展示与兜底管理。

**相关规格：** [本地需求发起](2026-08-12-local-requirement-intake-design.md) 的 Skill/MCP 合同在本规格中增补版本确认门禁，不回写该文全文。排期规格明确排除 Sprint/迭代/里程碑；本能力是发版归属，不是时间盒。

---

## 1. 背景与目标

FlowX 现有层级是 `Workspace → Project → Requirement`。项目只有名称、code、描述；需求有优先级和排期状态，没有发版归属。排期解决「谁在哪段时间做」，不解决「这条需求进哪个发布版本」。

仓库里已有的 `version` 语义都不是发版目录：

| 已有字段 | 含义 | 本规格 |
|---|---|---|
| `DeployJobRecord.version` | 部署产物版本 | 不改 |
| `Artifact.version` | 产物修订号 | 不改 |
| `IdeationArtifact.version` | 构思稿快照序号 | 不改 |

本规格要加的是云效/Jira Fix Version 这类**发布版本**：项目维护清单并标记当前版本，需求可选挂其中一个。

### 1.1 目标

- 项目有可管理的发布版本清单，并有一个可选的当前版本。
- 一条需求最多挂一个版本，允许不挂。
- 本地 `flowx-intake-requirement` 在创建需求前必须展示当前版本，由用户确认「用当前」或「新建版本」。
- Web 能看到当前版本和需求归属，并能管理清单、改需求归属；Web 创建需求仍是兜底。

### 1.2 非目标（一期）

- 版本状态、计划发布日、描述、自定义排序
- 一条需求挂多个版本
- Bug / Issue 挂版本
- 甘特图按版本分组
- 与云效或其他外部系统同步版本
- 强制 semver
- 在 Web「创建需求」表单里新建版本
- 改动工作流状态机、部署版本、Artifact 版本

---

## 2. 领域模型

```text
Project
  versions[]          → ProjectVersion
  currentVersionId?   → ProjectVersion   // 必须属于本项目

Requirement
  versionId?          → ProjectVersion   // 必须属于需求所在项目，可空
```

### 2.1 `ProjectVersion`

| 字段 | 说明 |
|---|---|
| `id` | cuid |
| `projectId` | 所属项目，删项目时级联删除版本 |
| `name` | 项目内唯一，自由文本（如 `2.6.0`），去空白后非空 |
| `createdAt` / `updatedAt` | 常规时间戳 |

不加 `status`、发布日、`description`、`sortOrder`。列表按 `createdAt` 升序。

### 2.2 不变量

1. `Project.currentVersionId` 为空，或指向本项目的某个 `ProjectVersion`。
2. `Requirement.versionId` 为空，或指向该需求 `projectId` 下的某个 `ProjectVersion`。跨项目引用拒绝。
3. 仍有需求引用该版本，或该版本仍是项目当前版本时，禁止删除。
4. 同项目 `name` 唯一（去空白后比较/写入）。

Prisma 上 `Project.currentVersionId` 与 `ProjectVersion.projectId` 形成可选环；跨项目归属无法靠 SQLite FK 表达，必须在 Service 校验。

### 2.3 创建需求时的 `versionId`

| 入参 | 行为 |
|---|---|
| 字段省略 | 使用项目 `currentVersionId`；项目没有当前版本则为空 |
| `null` | 明确不挂版本 |
| 具体 ID | 挂该版本；必须属于该需求的项目 |

本地 Skill **禁止省略**：必须传入用户确认后的 ID 或 `null`。Web 兜底表单也传显式值（当前版本 ID、其他已有 ID、或 `null`），避免打开表单后当前版本被改掉还 silently 吃新默认。

---

## 3. API

版本清单挂在 `projects` 模块，风格对齐需求下的 assignments。项目目前没有 `PATCH`，本次只开放 `currentVersionId`。

| 方法 | 路径 | 入参 | 成功 | 失败 |
|---|---|---|---|---|
| `GET` | `/projects/:id/versions` | — | 该项目版本列表，`createdAt` 升序 | 项目不存在 404 |
| `POST` | `/projects/:id/versions` | `{ name }` | 新建版本 | `name` 空 400；同项目重名 409 |
| `PATCH` | `/projects/:id/versions/:versionId` | `{ name }` | 改名（引用仍指向同一行） | 空名 400；重名 409；不属于该项目 404 |
| `DELETE` | `/projects/:id/versions/:versionId` | — | 删除 | 有需求引用或仍是当前版本 409 |
| `PATCH` | `/projects/:id` | `{ currentVersionId: string \| null }` | 设置/清空当前版本 | ID 不属于本项目 400 |

需求：

- `POST /requirements` 增加可选 `versionId`（含 `null`），规则见 §2.3。
- `PATCH /requirements/:id` 增加 `versionId`（含 `null` 清空），规则相同。
- `GET` 项目列表/详情、需求列表/详情带上：
  - 需求：`versionId`、`version: { id, name } \| null`
  - 项目：`currentVersionId`、`currentVersion: { id, name } \| null`、轻量 `versions: { id, name }[]`（按 `createdAt` 升序）
  - `GET /projects/:id/versions` 仍提供给 MCP 刷新与版本卡片；列表带轻量 `versions[]` 是为了 `flowx_list_projects` 和 Web 创建表单一次拿齐，不嵌套需求

一期不加 `GET /requirements?versionId=`。项目详情里的需求表用前端过滤。

错误不泄露内部 ID 关系以外的敏感信息；文案需能区分「跨项目」「仍被引用」「仍是当前版本」「重名」。

---

## 4. 本地发起（Skill / MCP）

主路径是 `flowx-intake-requirement`。发版选择与「选项目」「确认启动」同级，是硬门禁。

### 4.1 Skill 流程（插在选项目之后、创建需求之前）

1. `flowx_list_projects` 后，用户选定 `projectId`。
2. Skill **必须**展示该项目当前版本（或明确说没有当前版本），然后等待用户选择：
   - 有当前版本：**用当前版本** / **新建版本**
   - 无当前版本：**新建版本** / **本需求暂不挂版本**
   - 用户点名已有版本名（如 `2.5.0`）：用已有 ID，不新建
3. 选「新建版本」：先问名称，再调 `flowx_create_project_version`，`setAsCurrent: true`，需求挂到新版本。
4. 再调 `flowx_create_requirement`，**必须带**确认后的 `versionId` 或 `null`。
5. 创建成功回显增加版本名（未挂则说明未挂版本）。
6. 其后启动确认门禁不变。

禁止：未展示当前版本就创建；省略 `versionId` 靠服务端默认；未确认就把新建版本设为当前；用本地目录或 git 猜测版本。

### 4.2 MCP 合同

| 工具 | 变化 |
|---|---|
| `flowx_list_projects` | 每个项目增加 `currentVersion: { id, name } \| null` 与 `versions: { id, name }[]` |
| `flowx_create_project_version` | 新建。入参：`projectId`、`name`、可选 `setAsCurrent`（intake「新建」路径传 `true`） |
| `flowx_create_requirement` | 增加可选 `versionId`；Skill 必须传入用户确认值 |

`packages/flowx-local` 与兼容包 `flowx-mcp` 同步改工具、客户端和测试。Skill 源文件是 `packages/flowx-local/templates/flowx-intake-requirement/SKILL.md`；`setup` 安装到 Cursor/Codex 的副本必须含版本门禁原文。

MCP 仍是薄桥接，不在本地复制「跨项目校验 / 删除约束」；这些以 API 为准。

---

## 5. Web

Web 负责查看和兜底管理；发版决策主路径仍是本地 Skill。

### 5.1 展示

- 项目列表、项目详情：当前版本 Badge；没有则不渲染，不写「未设置」。
- 项目详情需求表、需求列表、需求详情：展示该需求挂的版本；未挂则不渲染。
- 项目详情需求表可按版本筛选（前端过滤）。

### 5.2 管理

- 项目详情「版本」卡片：新建、改名、设为当前、删除。仍被引用或仍是当前版本时删除不可用，并说明原因。
- 需求详情用与优先级相同的 Select，可改版本或清空。
- Web「创建需求」表单：选完项目后出现版本下拉，默认当前版本，可改为其他已有版本或「不挂版本」。**不在该表单新建版本**。

交互与样式走现有 `PageHeader`、Badge、Card、Select、Dialog，不新造视觉体系。

---

## 6. 文档

同一变更内更新：

- `docs/user-manual.md`：本地发起步骤补上版本确认；Web 项目/需求页说明当前版本与归属。同步 `apps/web/public/user-manual.md`。
- `docs/local-agent-guide.md`：intake Skill 增加版本门禁。同步 `apps/web/public/local-agent-guide.md`。
- `docs/system-design.md`：项目/需求模型补上 `ProjectVersion`。

交付前：

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

---

## 7. 测试

先补测试再改实现。高风险边界：Prisma 契约、`apps/web/src/api.ts`、需求创建、MCP 工具。

### 7.1 API

- 同项目重名 → 409；改名冲突 → 409
- `currentVersionId` / `versionId` 跨项目 → 400
- 删除仍被需求引用 → 409；删除仍是当前版本 → 409；无引用且非当前 → 可删
- 创建需求：省略 `versionId` 且项目有当前版本 → 挂当前；显式 `null` → 不挂；显式本项目 ID → 挂该版本
- `name` 仅空白 → 400

### 7.2 MCP / Skill

- `flowx_list_projects` 带出 `currentVersion` 与 `versions`
- `flowx_create_project_version` 在 `setAsCurrent: true` 时把项目当前版本切过去
- `flowx_create_requirement` 把 `versionId` 传到 API
- Skill 模板含：展示当前版本、用当前/新建、禁止省略 `versionId`
- `flowx-mcp` 镜像工具行为一致

### 7.3 Web

- 项目/需求展示当前或所属版本
- 创建表单选项目后默认当前版本；选「不挂版本」时请求带 `versionId: null`

---

## 8. 已确认决策

| 决策 | 结论 |
|---|---|
| 版本含义 | 发布版本，不是部署/Artifact/文档修订，也不是 Sprint |
| 需求基数 | 最多一个，可空 |
| 项目层 | 清单 + `currentVersionId` |
| 数据形状 | 独立 `ProjectVersion` 实体，不用两边散落字符串 |
| 作用域 | 项目级清单，不挂工作区 |
| 新建需求默认（API） | 省略 `versionId` 时用当前版本 |
| 本地 Skill | 必须展示并确认；禁止靠 API 默认 |
| Skill 新建版本 | 创建后 `setAsCurrent: true`，需求挂新版本 |
| Web 创建表单 | 只选已有版本或清空，不在表单里新建 |
| 删除 | 有引用或仍是当前版本则拒绝 |
| 列表筛选 | 一期前端过滤，不加 query API |

---

## 9. 实现落点（供计划拆任务，不在本规格展开）

- `prisma/schema.prisma` + migration
- `apps/api/src/projects/`（版本 CRUD、`PATCH` 当前版本）
- `apps/api/src/requirements/`（创建/更新 `versionId`）
- `apps/web/src/api.ts`、`types.ts`、项目/需求页面
- `packages/flowx-local` MCP + intake Skill 模板 + setup 测试
- `packages/flowx-mcp` 镜像
- 手册与系统设计
