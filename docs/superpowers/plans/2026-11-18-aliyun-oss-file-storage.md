# 阿里云 OSS 文件存储接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 为 FlowX 增加配置驱动的 `local|oss` 文件存储，让新 Artifact 和工作流 HTML 按配置写入私有 OSS，同时按已有记录继续读取历史本地文件。

**Architecture:** 保留 `ArtifactStorageProvider` 作为单对象存储接口，增加 `FileStorageService` 作为 provider registry 和默认路由。`ArtifactsService` 根据新文件默认 provider 或已有 Artifact 的 `storageProvider` 选择 local/OSS；工作流报告和设计页通过同一服务写入，旧 manifest/清单继续走本地兼容路径。API 仍代理所有上传和读取，端侧不接触 OSS 凭据。

**Tech Stack:** NestJS 11、TypeScript strict、Prisma、Vitest、`ali-oss`、`@flowx-ai/protocol`、pnpm workspace。

---

### Task 1: 扩展协议、依赖和配置样例

**Files:**
- Modify: `packages/flowx-protocol/src/artifact.ts`
- Modify: `apps/api/package.json`
- Modify: `.env.docker.example`
- Modify: `README.md`
- Modify: `docs/docker-deployment.md`
- Test: `packages/flowx-protocol/src/artifact.test.ts`（如现有测试文件不存在则创建）

- [ ] **Step 1: 写协议枚举回归测试**

在 protocol 测试中断言 `ARTIFACT_STORAGE_PROVIDERS` 包含 `oss` 且 `ArtifactManifest.storageProvider` 可以使用 `oss`：

```ts
import { describe, expect, it } from 'vitest';
import { ARTIFACT_STORAGE_PROVIDERS } from './artifact.js';

describe('artifact protocol', () => {
  it('supports oss artifact storage', () => {
    expect(ARTIFACT_STORAGE_PROVIDERS).toContain('oss');
  });
});
```

- [ ] **Step 2: 运行 protocol 测试确认新断言失败**

运行 `pnpm --filter @flowx-ai/protocol test`，预期新断言因枚举没有 `oss` 而失败。

- [ ] **Step 3: 增加 `oss` 枚举并安装 SDK**

把 `packages/flowx-protocol/src/artifact.ts` 的 provider 列表改为 `['local', 'minio', 's3', 'oss', 'external']`，在 `apps/api/package.json` 增加 `ali-oss` 运行时依赖，执行 `pnpm install` 更新 lockfile。

- [ ] **Step 4: 更新部署配置说明**

在 `.env.docker.example` 增加：

```env
FLOWX_FILE_STORAGE_PROVIDER=local
FLOWX_OSS_REGION=
FLOWX_OSS_BUCKET=
FLOWX_OSS_ACCESS_KEY_ID=
FLOWX_OSS_ACCESS_KEY_SECRET=
FLOWX_OSS_ENDPOINT=
FLOWX_OSS_PREFIX=flowx/prod
```

在 `README.md` 和 `docs/docker-deployment.md` 说明：默认 `local`，设为 `oss` 时需要私有 Bucket、RAM AK/SK，历史 Artifact 不迁移，读取按原 provider 路由；不要把密钥放 Web 或 `flowx-local` 配置。

- [ ] **Step 5: 验证并提交**

运行 `pnpm --filter @flowx-ai/protocol test` 和 `pnpm --filter @flowx-ai/protocol build`，预期通过；提交：

```bash
git add packages/flowx-protocol apps/api/package.json pnpm-lock.yaml .env.docker.example README.md docs/docker-deployment.md
git commit -m "支持 OSS 文件存储协议和部署配置"
```

### Task 2: 实现 local/OSS provider registry

**Files:**
- Modify: `apps/api/src/artifacts/artifact-storage.provider.ts`
- Create: `apps/api/src/artifacts/oss-artifact-storage.provider.ts`
- Create: `apps/api/src/artifacts/file-storage.service.ts`
- Create: `apps/api/src/artifacts/oss-artifact-storage.provider.spec.ts`
- Create: `apps/api/src/artifacts/file-storage.service.spec.ts`
- Modify: `apps/api/src/artifacts/artifacts.module.ts`

- [ ] **Step 1: 写 provider 行为测试**

mock `ali-oss` client，覆盖：OSS 配置缺失时构造失败；`write` 调用 `put(storageKey, Buffer)` 并返回 byteSize/sha256；`read` 使用 `get` 返回 Buffer；`stat` 使用 `head` 返回 content-length；SDK 错误转换为不含 endpoint/密钥的稳定错误。

- [ ] **Step 2: 写 registry 路由测试**

覆盖默认配置：未设置或 `local` 返回 local；设置 `oss` 返回 OSS；`get('local')` 和 `get('oss')` 分别返回对应 provider；不支持的 provider 抛出 `BadRequestException`；provider key 统一应用 `FLOWX_OSS_PREFIX`，避免重复斜杠。

- [ ] **Step 3: 实现 provider 接口和 OSS provider**

把接口拆成对象通用操作和 local 专用的 `resolvePath`（local 实现保留，OSS 不实现路径解析）。OSS provider 使用 `ali-oss`：

```ts
const client = new OSS({
  region,
  bucket,
  accessKeyId,
  accessKeySecret,
  ...(endpoint ? { endpoint } : {}),
});

async write(storageKey: string, content: Buffer) {
  const key = this.toObjectKey(storageKey);
  await this.client.put(key, content);
  return { storageKey, byteSize: content.byteLength, sha256: sha256(content) };
}
```

`read` 将 `get` 的 `content`、`Buffer`、`Uint8Array` 统一转为 `Buffer`；`stat` 从 `head` 的 `res.size` 或 `headers['content-length']` 解析整数。配置在 provider 创建时校验，Secret 不写日志。

- [ ] **Step 4: 实现 `FileStorageService` 和 Nest 注册**

`FileStorageService` 注入 local/OSS provider，提供 `defaultProviderName`、`providerFor(name)`、`write/read/stat`、`validateReference`。默认 provider 只允许 `local|oss`；按 Artifact 读取时允许已有 `minio|s3` 记录给出明确“不支持当前实例读取”的错误，不回退到错误 provider。`ArtifactsModule` 同时注册两个 provider 和 service，导出 `FileStorageService`。

- [ ] **Step 5: 运行 provider 测试并提交**

运行 `pnpm --filter flowx-api test -- src/artifacts/oss-artifact-storage.provider.spec.ts src/artifacts/file-storage.service.spec.ts src/artifacts/local-artifact-storage.provider.spec.ts`，预期通过；提交：

```bash
git add apps/api/src/artifacts
git commit -m "增加 local 和 OSS 文件存储 provider"
```

### Task 3: 接入 Artifact 上传、读取和默认 provider

**Files:**
- Modify: `apps/api/src/artifacts/artifacts.service.ts`
- Modify: `apps/api/src/artifacts/artifacts.controller.ts`
- Modify: `apps/api/src/artifacts/artifacts.service.spec.ts`
- Modify: `apps/api/src/execution-sessions/local-session-ownership.http.spec.ts`

- [ ] **Step 1: 补 Artifact 路由测试**

新增测试断言：默认 provider 为 OSS 时 `createManagedUpload` 创建 `storageProvider: 'oss'`，key 为稳定逻辑 key；`writeManagedContent` 调用 OSS provider；OSS Artifact 的 `readLocalContent`（重命名为 `readContent`）读取 OSS；local Artifact 在 OSS 默认配置下仍调用 local provider；大小/sha256 不匹配时两个 provider 都不会写入。

- [ ] **Step 2: 修改 service 使用 registry**

`ArtifactsService` 注入 `FileStorageService`，创建 managed/server-generated artifact 时使用 `defaultProviderName`，并把 provider 写入数据库。`writeManagedContent` 和 `readContent` 根据 artifact.storageProvider 选择 provider；删除逻辑保持数据库软删除。local key 继续 `resolvePath` 校验，OSS key 只做对象 key 校验。

- [ ] **Step 3: 保持 API 路由兼容**

控制器内部将 `readLocalContent` 改为通用 `readContent`，HTTP 路径 `/artifacts/:id/content`、响应头和 `flowx-local` 请求不变。对无法读取的旧 `minio/s3` provider 返回稳定 400/503 错误，不泄露 SDK 错误详情。

- [ ] **Step 4: 运行 Artifact/API 测试并提交**

运行 `pnpm --filter flowx-api test -- src/artifacts/artifacts.service.spec.ts src/execution-sessions/local-session-ownership.http.spec.ts`，再运行 `pnpm --filter flowx-api build`；通过后提交：

```bash
git add apps/api/src/artifacts apps/api/src/execution-sessions/local-session-ownership.http.spec.ts
git commit -m "让 Artifact 按配置写入和读取 OSS"
```

### Task 4: 接入工作流执行报告和设计 HTML

**Files:**
- Modify: `apps/api/src/workflow/workflow-artifact.service.ts`
- Modify: `apps/api/src/workflow/workflow.service.ts`
- Modify: `apps/api/src/workflow/workflow-artifact.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow.service.spec.ts`

- [ ] **Step 1: 写兼容性测试**

覆盖 local 默认仍生成现有本地文件；OSS 默认使用 `FileStorageService.write` 写 `workflow/...` 和 `design/...`，manifest/设计页引用包含 `artifactId/storageProvider/storageKey`；读取新引用从 provider 读取；没有引用的旧 manifest/清单继续从本地路径读取。

- [ ] **Step 2: 修改执行报告服务**

保留 local provider 下现有本地 manifest 文件行为以保护历史测试和旧文件；当默认 provider 为 OSS 时，通过 `ArtifactsService`/`FileStorageService` 写入 HTML、meta 和 manifest 对象，数据库 Artifact 的 `storageProvider` 为 `oss`，manifest 记录对象引用。`readExecutionHtml` 先读新引用，失败再按旧本地相对路径回退。

- [ ] **Step 3: 修改设计页持久化和读取**

设计页写入先通过默认 provider 保存 HTML，再注册 Artifact；新清单保存 `artifactId` 和 provider/key；读取优先调用 Artifact provider，旧清单保留当前本地安全相对路径检查。

- [ ] **Step 4: 运行 workflow 测试并提交**

运行 `pnpm --filter flowx-api test -- src/workflow/workflow-artifact.service.spec.ts src/workflow/workflow.service.spec.ts`，再运行 API build；通过后提交：

```bash
git add apps/api/src/workflow
git commit -m "让工作流 HTML Artifact 支持 OSS"
```

### Task 5: 文档、变更记录和全链路验证

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-11-18-aliyun-oss-file-storage-design.md`（仅在实现细节需要校正时）
- Test: protocol/API/local package checks

- [ ] **Step 1: 更新 CHANGELOG**

在 `2026-11-18` 未发布条目加入用户可见变化：新增 `FLOWX_FILE_STORAGE_PROVIDER`、私有 OSS、历史文件不迁移且按原 provider 读取、客户端继续走 API。

- [ ] **Step 2: 做全链路验证**

依次运行：

```bash
pnpm --filter @flowx-ai/protocol test
pnpm --filter @flowx-ai/protocol build
pnpm --filter flowx-api test
pnpm --filter flowx-api build
pnpm --filter @flowx-ai/local test
pnpm --filter @flowx-ai/local build
git diff --check
```

预期所有命令退出码为 0；如有既有失败，记录精确命令、失败用例和与本次改动的关系。

- [ ] **Step 3: 检查文档和配置一致性**

确认 `.env.docker.example`、`README.md`、`docs/docker-deployment.md` 与实际环境变量一致；确认 `flowx-local` 没有新增 OSS Secret 读取；确认没有修改 `.flowx-data`、`dist/` 或生成 Prisma client。

- [ ] **Step 4: 提交最终变更**

```bash
git add CHANGELOG.md docs README.md .env.docker.example
git commit -m "完成阿里云 OSS 文件存储接入"
```

