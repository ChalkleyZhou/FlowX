# 阿里云 OSS 文件存储接入设计

## 背景

FlowX 当前已有 `Artifact` 数据模型和 `ArtifactStorageProvider` 抽象，但实际只有本地文件实现。上传、下载、执行报告、设计 HTML 和测试报告仍依赖 API 进程所在机器的项目文件服务。生产环境希望使用阿里云 OSS，同时保留本地开发能力，并参考 Dify 的配置驱动存储工厂模式。

本次采用双存储并存策略：新文件根据配置写入 `local` 或 `oss`；已有文件不迁移、不覆盖、不删除，按 Artifact 记录中的 `storageProvider` 继续读取。

## 目标

- 支持通过一个配置切换新文件的默认存储：`local` 或 `oss`。
- 使用官方 `ali-oss` SDK 接入私有 Bucket。
- API 继续作为上传和读取入口，保持 Web、`flowx-local`、MCP 和 Outbox 契约不变。
- 让 Artifact、执行报告和设计 HTML 使用统一文件存储路由。
- 兼容已有 `local|minio|s3|external` Artifact，新增 `oss` provider。
- 不迁移历史文件，不扫描或修改 `.flowx-data` 中已有文件。

## 非目标

- 本次不提供历史文件批量迁移命令。
- 本次不做 OSS 预签名直传，客户端不直接访问 OSS。
- 不把原型归档、Bug 截图等当前未纳入 `Artifact` 中的文件自动迁移到 OSS；这些模块后续单独接入统一文件服务。
- 不改变 Artifact 权限、执行会话所有权、组织隔离和软删除语义。

## 方案对比与选择

### 方案一：官方 `ali-oss` SDK + API 代理（采用）

API 使用 `ali-oss` 写入和读取私有 Bucket，客户端始终请求 FlowX API。改动集中在服务端，现有 Agent、MCP、Outbox 和 Web 下载流程可以复用；同时保留 API 侧的权限、摘要校验和审计边界。

### 方案二：OSS S3 兼容接口

使用 AWS SDK 的 S3 Client 对接 OSS。抽象复用性更高，但需要额外处理 endpoint、签名版本和 OSS 兼容性，排障成本较高，不作为首期实现。

### 方案三：OSS 预签名直传

API 只签发短期 URL，Web 或本地 Agent 直接上传/下载 OSS。大文件吞吐更好，但需要改动协议、前端、MCP、Outbox、CORS 和下载鉴权，不符合本次保持既有端侧链路稳定的目标。

## 架构

### 存储接口与路由

保留 `ArtifactStorageProvider` 作为底层 provider 接口，补充一个统一的 `FileStorageService`（或等价 registry）负责：

- 根据 `FLOWX_FILE_STORAGE_PROVIDER` 选择新文件的默认 provider；
- 根据 Artifact 已保存的 `storageProvider` 选择读取和更新 provider；
- 暴露 `write`、`read`、`stat` 等与业务无关的对象操作；
- 不允许业务模块直接导入 `ali-oss`。

实现包括：

- `LocalArtifactStorageProvider`：继续使用项目文件服务，保留路径穿越校验和现有命名空间。
- `OssArtifactStorageProvider`：使用 `ali-oss`，Bucket 保持私有；对象 key 不包含绝对路径和密钥。

`ArtifactsService` 的 managed upload、server-generated artifact、执行报告和设计 HTML 均通过统一服务写入。读取时优先使用数据库中记录的 provider；历史文件没有 OSS 引用时仍走本地兼容路径。

### 对象 key

对象 key 使用稳定、可重试的逻辑 key，并在 OSS Bucket 内增加组织和用户隔离层：

```text
{prefix}/org/{organizationId}/user/{userId}/managed/{executionSessionId}/{artifactId}/{safeName}
{prefix}/org/{organizationId}/user/{userId|system}/server/{artifactId}/{safeName}
{prefix}/org/{organizationId}/workflow/workflow/{workflowRunId}/artifacts/execution/v1/report.html
{prefix}/org/{organizationId}/workflow/design/{workflowRunId}/{surface}/{page}-{timestamp}.html
```

数据库 `storageKey` 保存不含配置 `FLOWX_OSS_PREFIX`、但包含组织/用户 namespace 的 key，`storageProvider` 保存 `oss`。工作流资源按组织和 workflow 共享；执行会话上传及服务端生成资源按组织和用户分区。Bucket、endpoint 和 prefix 由服务端配置决定。文件名继续使用现有安全化规则，禁止 `..`、绝对路径和空路径段。历史未带 namespace 的 OSS key 继续按数据库记录读取，不执行迁移。

### 上传流程

```text
flowx-local / Web
  -> POST /execution-sessions/:id/artifact-uploads
  -> API 按默认 provider 创建 PENDING Artifact
  -> PUT /artifacts/:id/content
  -> API 校验权限、大小、byteSize 和 sha256
  -> local 或 OSS 写入对象
  -> API 更新 Artifact 为 AVAILABLE
```

`flowx-local` 的请求路径、响应结构和 Outbox payload 保持不变；它不需要 OSS 凭据，也不需要理解 OSS SDK。

### 读取流程

```text
Web / flowx-local
  -> GET /artifacts/:id/content 或工作流预览接口
  -> API 校验组织权限
  -> 根据 Artifact.storageProvider 读取 local 或 OSS
  -> API 返回原 mimeType、文件名和内容
```

Bucket 不开放公共读，API 不向调用方返回签名 URL。

### 工作流 HTML 兼容

设计页清单和执行报告 manifest 增加可选的 `artifactId`、`storageProvider`、`storageKey` 引用：

- 新生成的内容写入当前默认 provider，并记录对象引用。
- 新接口读取优先通过 Artifact provider。
- 历史清单没有引用字段时，继续使用已有相对本地路径读取。

这样切换默认 provider 不会影响旧设计页和旧执行报告。

## 配置与安全

### 环境变量

```env
FLOWX_FILE_STORAGE_PROVIDER=local
FLOWX_OSS_REGION=oss-cn-hangzhou
FLOWX_OSS_BUCKET=flowx-prod
FLOWX_OSS_ACCESS_KEY_ID=
FLOWX_OSS_ACCESS_KEY_SECRET=
FLOWX_OSS_ENDPOINT=
FLOWX_OSS_PREFIX=flowx/prod
```

`FLOWX_FILE_STORAGE_PROVIDER` 未配置时默认为 `local`。设置为 `oss` 时，API 启动阶段校验 region、bucket、AccessKey ID 和 Secret；缺失配置直接失败，避免请求运行到上传阶段才暴露问题。`FLOWX_OSS_ENDPOINT` 可用于内网 endpoint 或专有域名。

### RAM 权限

创建专用 RAM 用户，仅授予目标 Bucket 的：

- `oss:PutObject`
- `oss:GetObject`
- `oss:HeadObject`

Artifact 删除仍是数据库软删除，不授予 `oss:DeleteObject`。AK/SK 只通过部署环境变量或 Secret 注入，不写数据库、Artifact metadata、日志和客户端配置。

## 状态、错误和幂等

- OSS 写入失败时 Artifact 保持 `PENDING`，API 返回可重试错误，现有 Outbox 负责重试。
- 上传前校验 100 MB 上限、声明大小和 sha256；provider 返回的 byteSize/sha256 用于最终更新。
- 数据库更新失败时重试使用同一个 object key 覆盖，避免重复对象；永久失败的孤儿对象由后续运维清理，不影响已登记 Artifact。
- OSS 读取异常转换为统一的 Artifact 读取错误，不返回 Bucket、endpoint 或凭据细节。
- 现有 `DELETED` 软删除语义保持不变。
- 新建 Artifact 的 `storageProvider` 由默认配置决定；已有 Artifact 按数据库值路由，不因默认配置变化而隐式迁移。

## 协议与本地适配

- `@flowx-ai/protocol` 的 `ARTIFACT_STORAGE_PROVIDERS` 增加 `oss`。
- API DTO、`ArtifactsService` 和 Web 类型继续使用共享枚举。
- `flowx-local` 不新增 OSS 工具或配置，继续调用 API 的创建上传和内容上传接口；本次只需验证共享类型和现有 Outbox 兼容。
- MCP 工具描述继续使用“上传 FlowX Artifact”，不向端侧暴露存储实现细节。
- 交付文档明确：新文件受默认 provider 控制，历史文件按 Artifact 记录读取，没有迁移动作。

## 测试与验收

### 单元测试

- OSS provider 的配置校验、key 拼接、`put/get/head` 调用和错误转换。
- `FileStorageService` 的默认 provider 路由及按 Artifact provider 读取。
- managed upload 的 PENDING → AVAILABLE、大小/摘要不匹配和重复上传。
- local 默认和 OSS 默认下的 server-generated artifact。
- 历史 local Artifact 在 OSS 默认配置下仍从本地读取。

### API/集成测试

- 私有 OSS provider 的上传、读取、组织隔离和软删除行为，使用 mock OSS client，不依赖真实云账号。
- 设计页和执行报告新引用字段的写入与读取，以及旧 manifest/清单的本地兼容回退。
- Web API 类型、protocol build、`flowx-local` test/build 和 API test。

### 文档检查

- 更新 `README.md`、`docs/docker-deployment.md`、`.env.docker.example` 和相关用户/运维说明。
- 更新 `CHANGELOG.md`。
- 执行 `git diff --check`；手册文件未修改时无需执行镜像 `cmp`。

## 交付顺序

1. 先补 provider、路由和协议测试。
2. 实现 `OssArtifactStorageProvider` 与配置校验。
3. 将 Artifact managed/server-generated 及工作流 HTML 接入统一文件服务。
4. 补齐新旧引用兼容和 API 代理读取。
5. 更新配置示例、Docker 文档、README 和 CHANGELOG。
6. 运行协议、API、local package 测试和构建，再进行 diff/doc 自检。

