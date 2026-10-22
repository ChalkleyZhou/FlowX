# 原型 ZIP 导入

已有 OpenDesign 或其他工具导出的原型时，可直接使用「需求 → 创建需求 → 已有原型」，选择项目、ZIP 和 Codex / Cursor。目标可选，不要求先重写 PRD。

## 必要路径

1. 上传后自动创建待整理需求，后台识别材料并生成需求、验收标准、设计说明、来源依据和推断。
2. 在需求详情查看原型，修改草稿，集中回答影响研发的关键问题；建议答案需主动采用。保存后可刷新恢复。
3. 缺内容时填写调整意见重新整理，或补传 ZIP。同路径替换，其余文件保留；每次原始 ZIP 均可单独下载。重试失败保留材料与已有草稿。
4. 点击「确认方案，继续研发」一次确认。平台保存确认稿，启动工作流，仓库准备完成后进入 Spec & Plan，直接复用原型与设计。确认后的材料只读；启动失败可继续重试，不要求重新确认。

多人可在组织内查看和编辑；草稿按版本保存，旧页面不能覆盖新版本。发现冲突会保留本地编辑并提示，可复制所需内容后明确载入最新版本再合并。导入路径不增加人员分配、领取任务或重复设计审批。

## 材料与预览范围

| 材料 | 当前处理 |
| --- | --- |
| HTML | 保留原始页面，优先 `index.html`；内联包内 CSS、图片、字体，保留可支持的脚本交互和包内页面导航 |
| 图片 | 保留预览和文件信息；本轮不向 AI 提供视觉理解，不能声称已读懂图片细节 |
| Markdown、文本、JSON、CSV | 提供有限文本摘录和文字预览 |
| JS、TS、CSS 等源码 | 提供有限摘录；HTML 引用的静态模块可受限打包，不安装依赖、不执行项目命令、不启动开发服务器 |
| PDF、Word | 仅保存附件，未提取正文；请附 HTML、Markdown 或文字说明 |
| 其他资源 | 保存在原包和清单中；不保证运行或预览 |

原型在无 same-origin 的 sandbox iframe 内运行，可信父外壳通过 CSP 阻断原型自身外部导航；新窗口也保留该外壳。常规联网资源、请求、表单与嵌套框架受限制，不提供后端 API；需要网络、动态加载、Worker 或构建工具的原型可能无法完整运行。它适合核对页面与本地交互，不能代表真实系统功能已实现。不要在原型中填写真实凭据。

AI 依据有界清单和文本摘录分析，整体上下文上限 90,000 字符、单文件摘录最多 6000 字符；截断内容不代表已分析。问题与来源路径经过校验，但仍需人工核对实际业务范围。

## 体积限制与保存

- ZIP 最大 20 MiB，单文件最大 5 MiB，合并后最多 1500 文件、60 MiB。
- 拒绝越界/绝对路径、符号链接、特殊文件、加密包、重复路径和损坏 ZIP。
- 单页隔离预览最大 12 MiB。进入工作流的设计页面单页最多 5 MiB、总体最多 24 MiB，超过预算时展示提示页，可回到需求查看或下载原包。
- 原材料私有保存到 API 工作目录 `.flowx-data/prototype-imports/{id}/{materialRevision}`。各次 ZIP 与合并后清单按材料版本保留。材料版本和草稿 revision 分离，编号不一定连续。
- 数据库记录包含组织关联、分析、答案、确认人与时间；下载和预览需登录且属于该组织。

## API 与部署

新增 `PrototypeImport` 表，与 Requirement 一对一关联。已有部署升级前备份数据库，按仓库现有流程生成 Prisma client 并同步 schema；相关 migration 为 `20261022090000_prototype_import`。确保 API 运行数据目录持久化并随 SQLite 一起备份。Docker 继续使用现有 schema 同步和运行目录卷，无新增环境变量。

| 接口 | 用途 |
| --- | --- |
| `POST /prototype-imports` | multipart `file`、`projectId`、可选 `goal`、`aiProvider`，创建并后台分析 |
| `GET /prototype-imports/:id` | 状态、材料清单、草稿与答案 |
| `PATCH /prototype-imports/:id` | `revision`、可选 `analysis`、`answers`，保存草稿 |
| `POST /prototype-imports/:id/analyze` | 同上及可选 `feedback`，重试或修订 |
| `POST /prototype-imports/:id/files` | multipart `file`、`revision`，合并补传并重新分析 |
| `POST /prototype-imports/:id/confirm` | 校验当前 revision 和必答项，锁定确认稿 |
| `GET /prototype-imports/:id/preview?path=...` | JSON `html` 和 `warnings`，用于 sandbox 预览 |
| `GET /prototype-imports/:id/source?revision=...` | 授权下载对应上传版本的 ZIP |

确认接口本身不创建工作流，Web 随后调用既有创建接口，因此创建失败不影响已确认结果。创建工作流写入确认快照，仓库 grounding 完成后接续 Spec & Plan。未确认导入不能从普通入口绕过确认。

状态为 `ANALYZING`、`WAITING_CONFIRMATION`、`FAILED`、`CONFIRMED`。异步任务采用当前单进程模型，服务重启会将未完成整理标为失败，用户可重试；不具备多实例持久任务队列。Codex / Cursor 需使用现有可用 AI 配置，不支持的 executor 会明确失败，不返回伪造分析。
