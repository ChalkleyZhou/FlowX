# 项目/需求发布版本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给项目加上发布版本清单和当前版本，需求最多挂一个版本；本地 intake 创建前必须确认版本，Web 可展示并兜底管理。

**Architecture:** 新增 `ProjectVersion` 实体。`Project.currentVersionId` 与 `Requirement.versionId` 都指向它。版本 CRUD 放在 `projects` 模块；需求创建/更新在 `requirements` 模块校验归属。MCP 薄桥接 REST；Skill 负责硬门禁。不改部署/Artifact/构思稿的 version 字段，不改工作流状态机。

**Tech Stack:** Prisma/SQLite、NestJS、Vitest、React、MCP SDK。

**Spec:** `docs/superpowers/specs/2026-08-13-project-requirement-release-version-design.md`

## Global Constraints

- 默认简体中文文档与 UI 文案；代码标识符保持英文。
- 不修改 `DeployJobRecord.version`、`Artifact.version`、`IdeationArtifact.version`。
- 不改工作流状态机；不加版本状态/发布日；一条需求最多一个版本且可空。
- 本地 Skill **禁止省略** `versionId`（必须传确认后的 ID 或 `null`）。Web 创建表单也传显式值。
- Radix `Select` 不能用空字符串表示「不挂版本」，一律用哨兵 `__unversioned__`，提交时映射为 `null`。
- `GET /projects` 返回轻量 `versions: { id, name }[]` + `currentVersion`，供 MCP 和 Web 创建表单一次拿齐。
- 提交须用户明确授权；未授权则跳过各任务的 Commit 步骤，保留工作区改动。
- 高风险路径先写失败测试再改实现。

---

## File map

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | `ProjectVersion`、`Project.currentVersionId`、`Requirement.versionId` |
| `prisma/migrations/20260813120000_add_project_version/migration.sql` | SQLite 迁移 |
| `apps/api/src/projects/project-versions.service.ts` | 版本 CRUD、设当前、重名/删除约束 |
| `apps/api/src/projects/project-versions.service.spec.ts` | 版本服务测试 |
| `apps/api/src/projects/dto/create-project-version.dto.ts` | `{ name }` |
| `apps/api/src/projects/dto/update-project-version.dto.ts` | `{ name }` |
| `apps/api/src/projects/dto/update-project.dto.ts` | `{ currentVersionId: string \| null }` |
| `apps/api/src/projects/projects.controller.ts` | 嵌套 versions 路由 + `PATCH /projects/:id` |
| `apps/api/src/projects/projects.service.ts` | list/detail 带 `currentVersion` 与轻量 `versions` |
| `apps/api/src/projects/projects.module.ts` | 注册 `ProjectVersionsService` |
| `apps/api/src/requirements/dto/create-requirement.dto.ts` | 可选可空 `versionId` |
| `apps/api/src/requirements/dto/update-requirement.dto.ts` | 可选可空 `versionId` |
| `apps/api/src/requirements/requirements.service.ts` | 解析默认/null/显式 ID，include `version` |
| `apps/api/src/requirements/requirement-version.spec.ts` | 需求挂版本测试 |
| `apps/web/src/types.ts`、`apps/web/src/api.ts` | 前端契约 |
| `apps/web/src/components/ProjectVersionsPanel.tsx` | 项目详情版本卡片 |
| `apps/web/src/pages/ProjectsPage.tsx`、`ProjectDetailPage.tsx`、`RequirementsPage.tsx`、`RequirementDetailPage.tsx` | 展示与筛选 |
| `apps/web/src/components/RequirementSchedulingPanel.tsx` | 需求改版本 |
| `packages/flowx-local/src/mcp.ts`、`mcp.test.ts` | list 带版本；create version；create requirement 传 `versionId` |
| `packages/flowx-local/templates/flowx-intake-requirement/SKILL.md` | 版本确认门禁 |
| `packages/flowx-mcp/src/tools.ts`、`flowx-api-client.ts`、测试 | 兼容包镜像 |
| `docs/user-manual.md`、`docs/local-agent-guide.md`、`docs/system-design.md` + public 镜像 | 用户可见文档 |

---

### Task 1: Prisma `ProjectVersion`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260813120000_add_project_version/migration.sql`

**Interfaces:**
- Consumes: 现有 `Project`、`Requirement`
- Produces: `ProjectVersion` 模型；`Project.currentVersionId`；`Requirement.versionId`

- [ ] **Step 1: 在 `Project` 与 `Requirement` 上加关系字段，并新增模型**

在 `prisma/schema.prisma` 的 `Requirement` 中、`project` 关系后加入：

```prisma
  versionId               String?
  version                 ProjectVersion?         @relation(fields: [versionId], references: [id], onDelete: Restrict)
```

并把 `@@index([projectId, createdAt])` 改为同时保留：

```prisma
  @@index([projectId, createdAt])
  @@index([projectId, versionId])
```

在 `Project` 中、`requirements` 关系附近加入：

```prisma
  currentVersionId String?
  currentVersion   ProjectVersion?  @relation("ProjectCurrentVersion", fields: [currentVersionId], references: [id], onDelete: Restrict)
  versions         ProjectVersion[] @relation("ProjectVersions")
```

在 `Project` 与 `ProjectDeployConfig` 之间插入：

```prisma
model ProjectVersion {
  id                 String        @id @default(cuid())
  projectId          String
  project            Project       @relation("ProjectVersions", fields: [projectId], references: [id], onDelete: Cascade)
  name               String
  currentForProjects Project[]     @relation("ProjectCurrentVersion")
  requirements       Requirement[]
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@unique([projectId, name])
  @@index([projectId, createdAt])
}
```

- [ ] **Step 2: 写 migration**

创建 `prisma/migrations/20260813120000_add_project_version/migration.sql`：

```sql
-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_name_key" ON "ProjectVersion"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "ProjectVersion"("projectId", "createdAt");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("id", "status", "workspaceId", "name", "code", "description", "createdAt", "updatedAt")
SELECT "id", "status", "workspaceId", "name", "code", "description", "createdAt", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_workspaceId_createdAt_idx" ON "Project"("workspaceId", "createdAt");

CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "planningStatus" TEXT NOT NULL DEFAULT 'UNSCHEDULED',
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "ideationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "versionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Requirement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("id", "status", "title", "description", "acceptanceCriteria", "priority", "planningStatus", "projectId", "workspaceId", "ideationStatus", "createdAt", "updatedAt")
SELECT "id", "status", "title", "description", "acceptanceCriteria", "priority", "planningStatus", "projectId", "workspaceId", "ideationStatus", "createdAt", "updatedAt" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE INDEX "Requirement_projectId_createdAt_idx" ON "Requirement"("projectId", "createdAt");
CREATE INDEX "Requirement_projectId_versionId_idx" ON "Requirement"("projectId", "versionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

写完后对照当前 `schema.prisma` 里 `Project`/`Requirement` 的全部列；若库里已有额外列，把它们补进 `CREATE TABLE "new_*"` 和 `INSERT`，不要丢列。

- [ ] **Step 3: 生成 Prisma Client**

Run: `pnpm prisma:generate`

Expected: 成功，无 relation 错误。

- [ ] **Step 4: Commit（仅当用户授权）**

```bash
git add prisma/schema.prisma prisma/migrations/20260813120000_add_project_version/migration.sql
git commit -m "$(cat <<'EOF'
feat(db): add ProjectVersion for release tracking

EOF
)"
```

---

### Task 2: `ProjectVersionsService` CRUD（TDD）

**Files:**
- Create: `apps/api/src/projects/project-versions.service.ts`
- Create: `apps/api/src/projects/project-versions.service.spec.ts`
- Create: `apps/api/src/projects/dto/create-project-version.dto.ts`
- Create: `apps/api/src/projects/dto/update-project-version.dto.ts`
- Create: `apps/api/src/projects/dto/update-project.dto.ts`
- Modify: `apps/api/src/projects/projects.module.ts`
- Modify: `apps/api/src/projects/projects.controller.ts`
- Modify: `apps/api/src/projects/projects.service.ts`

**Interfaces:**
- Consumes: `PrismaService`；`ProjectVersion` 模型
- Produces:
  - `list(projectId: string): Promise<ProjectVersion[]>`
  - `create(projectId: string, dto: { name: string }): Promise<ProjectVersion>`
  - `update(projectId: string, versionId: string, dto: { name: string }): Promise<ProjectVersion>`
  - `remove(projectId: string, versionId: string): Promise<{ ok: true }>`
  - `setCurrentVersion(projectId: string, currentVersionId: string | null): Promise<Project>`
  - 错误文案：`Version name is required.` / `A version with this name already exists in the project.` / `Cannot delete a version that is still assigned to requirements.` / `Cannot delete the project's current version.` / `Version does not belong to this project.` / `Project not found.` / `Version not found.`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/projects/project-versions.service.spec.ts`：

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectVersionsService } from './project-versions.service';

describe('ProjectVersionsService', () => {
  const projectId = 'proj-1';
  const version = {
    id: 'ver-1',
    projectId,
    name: '2.6.0',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
  };
  let prisma: {
    project: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    projectVersion: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    requirement: { count: ReturnType<typeof vi.fn> };
  };
  let service: ProjectVersionsService;

  beforeEach(() => {
    prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ id: projectId, currentVersionId: null }),
        update: vi.fn(),
      },
      projectVersion: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      requirement: { count: vi.fn() },
    };
    service = new ProjectVersionsService(prisma as never);
  });

  it('rejects blank names', async () => {
    await expect(service.create(projectId, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate names as 409', async () => {
    prisma.projectVersion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.0.0' }),
    );
    await expect(service.create(projectId, { name: '2.6.0' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses delete when requirements still reference the version', async () => {
    prisma.projectVersion.findFirst.mockResolvedValue(version);
    prisma.requirement.count.mockResolvedValue(1);
    await expect(service.remove(projectId, version.id)).rejects.toThrow(/still assigned to requirements/);
  });

  it('refuses delete when the version is current', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: projectId, currentVersionId: version.id });
    prisma.projectVersion.findFirst.mockResolvedValue(version);
    prisma.requirement.count.mockResolvedValue(0);
    await expect(service.remove(projectId, version.id)).rejects.toThrow(/current version/);
  });

  it('rejects currentVersionId from another project', async () => {
    prisma.projectVersion.findFirst.mockResolvedValue(null);
    await expect(service.setCurrentVersion(projectId, 'ver-other')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-api exec vitest run src/projects/project-versions.service.spec.ts`

Expected: FAIL（找不到 `ProjectVersionsService`）。

- [ ] **Step 3: 实现 service 与 DTO**

`apps/api/src/projects/dto/create-project-version.dto.ts` 与 `update-project-version.dto.ts`：

```ts
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProjectVersionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
```

`UpdateProjectVersionDto` 同样只有 `name`。

`apps/api/src/projects/dto/update-project.dto.ts`：

```ts
import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  currentVersionId?: string | null;
}
```

`apps/api/src/projects/project-versions.service.ts`：

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string) {
    await this.requireProject(projectId);
    return this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(projectId: string, dto: { name: string }) {
    await this.requireProject(projectId);
    const name = this.normalizeName(dto.name);
    try {
      return await this.prisma.projectVersion.create({ data: { projectId, name } });
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async update(projectId: string, versionId: string, dto: { name: string }) {
    await this.requireOwnedVersion(projectId, versionId);
    const name = this.normalizeName(dto.name);
    try {
      return await this.prisma.projectVersion.update({ where: { id: versionId }, data: { name } });
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async remove(projectId: string, versionId: string) {
    const project = await this.requireProject(projectId);
    await this.requireOwnedVersion(projectId, versionId);
    if (project.currentVersionId === versionId) {
      throw new ConflictException("Cannot delete the project's current version.");
    }
    const assigned = await this.prisma.requirement.count({ where: { versionId } });
    if (assigned > 0) {
      throw new ConflictException('Cannot delete a version that is still assigned to requirements.');
    }
    await this.prisma.projectVersion.delete({ where: { id: versionId } });
    return { ok: true as const };
  }

  async setCurrentVersion(projectId: string, currentVersionId: string | null) {
    await this.requireProject(projectId);
    if (currentVersionId !== null) {
      await this.requireOwnedVersion(projectId, currentVersionId, true);
    }
    return this.prisma.project.update({
      where: { id: projectId },
      data: { currentVersionId },
      include: this.projectVersionInclude(),
    });
  }

  private projectVersionInclude() {
    return {
      currentVersion: { select: { id: true, name: true } },
      versions: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' as const } },
    };
  }

  private normalizeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Version name is required.');
    }
    return trimmed;
  }

  private async requireProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, currentVersionId: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }

  private async requireOwnedVersion(projectId: string, versionId: string, asBadRequest = false) {
    const version = await this.prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
    if (!version) {
      if (asBadRequest) {
        throw new BadRequestException('Version does not belong to this project.');
      }
      throw new NotFoundException('Version not found.');
    }
    return version;
  }

  private rethrowDuplicate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A version with this name already exists in the project.');
    }
    throw error;
  }
}
```

- [ ] **Step 4: 接到 controller，并让项目 list/detail 带版本**

`projects.module.ts` 的 `providers` / `exports` 加上 `ProjectVersionsService`。

`projects.controller.ts` 增加（`@Get(':id')` 保持原样，嵌套路由可并列）：

```ts
@Get(':id/versions')
listVersions(@Param('id') id: string) {
  return this.projectVersionsService.list(id);
}

@Post(':id/versions')
createVersion(@Param('id') id: string, @Body() dto: CreateProjectVersionDto) {
  return this.projectVersionsService.create(id, dto);
}

@Patch(':id/versions/:versionId')
updateVersion(
  @Param('id') id: string,
  @Param('versionId') versionId: string,
  @Body() dto: UpdateProjectVersionDto,
) {
  return this.projectVersionsService.update(id, versionId, dto);
}

@Delete(':id/versions/:versionId')
removeVersion(@Param('id') id: string, @Param('versionId') versionId: string) {
  return this.projectVersionsService.remove(id, versionId);
}

@Patch(':id')
update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
  return this.projectVersionsService.setCurrentVersion(id, dto.currentVersionId ?? null);
}
```

注意：`PATCH /projects/:id` 只开放 `currentVersionId`。`dto.currentVersionId === undefined` 时不要误清成 null。若请求体是 `{ currentVersionId: null }` 才清空。实现改为：

```ts
@Patch(':id')
update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
  if (!Object.prototype.hasOwnProperty.call(dto, 'currentVersionId')) {
    throw new BadRequestException('currentVersionId is required.');
  }
  return this.projectVersionsService.setCurrentVersion(id, dto.currentVersionId ?? null);
}
```

在 `ProjectsService.findAll` / `findOne` 的 `include` 中加入：

```ts
currentVersion: { select: { id: true, name: true } },
versions: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' as const } },
```

`findOne` 的 `requirements` include 再加：

```ts
version: { select: { id: true, name: true } },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter flowx-api exec vitest run src/projects/project-versions.service.spec.ts`

Expected: PASS

- [ ] **Step 6: Commit（仅当用户授权）**

```bash
git add apps/api/src/projects
git commit -m "$(cat <<'EOF'
feat(api): add project release version CRUD

EOF
)"
```

---

### Task 3: 需求 `versionId` 解析（TDD）

**Files:**
- Modify: `apps/api/src/requirements/dto/create-requirement.dto.ts`
- Modify: `apps/api/src/requirements/dto/update-requirement.dto.ts`
- Modify: `apps/api/src/requirements/requirements.service.ts`
- Create: `apps/api/src/requirements/requirement-version.spec.ts`

**Interfaces:**
- Consumes: `Project.currentVersionId`、`ProjectVersion`
- Produces: 创建/更新/列表/详情均带 `versionId` 与 `version: { id, name } | null`
  - 省略 `versionId` → `project.currentVersionId`
  - `null` → 不挂
  - 显式 ID → 必须属于该项目，否则 `BadRequestException('Version does not belong to this project.')`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/requirements/requirement-version.spec.ts`。用 prisma mock 实例化 `RequirementsService` 时，构造函数其余依赖用 `{} as never` 或 `vi.fn()` 占位；只测 `create` / `update` 对 `versionId` 的解析。若构造函数依赖过多导致难以实例化，把解析抽成 `apps/api/src/requirements/resolve-requirement-version.ts` 纯函数并测它：

```ts
export async function resolveRequirementVersionId(input: {
  versionId?: string | null;
  currentVersionId: string | null;
  assertOwned: (versionId: string) => Promise<void>;
}): Promise<string | null> {
  if (!Object.prototype.hasOwnProperty.call(input, 'versionId') || input.versionId === undefined) {
    return input.currentVersionId;
  }
  if (input.versionId === null) {
    return null;
  }
  await input.assertOwned(input.versionId);
  return input.versionId;
}
```

测试：

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveRequirementVersionId } from './resolve-requirement-version';

describe('resolveRequirementVersionId', () => {
  it('defaults to current version when omitted', async () => {
    await expect(
      resolveRequirementVersionId({ currentVersionId: 'ver-1', assertOwned: vi.fn() }),
    ).resolves.toBe('ver-1');
  });

  it('keeps unversioned when explicitly null', async () => {
    await expect(
      resolveRequirementVersionId({ versionId: null, currentVersionId: 'ver-1', assertOwned: vi.fn() }),
    ).resolves.toBeNull();
  });

  it('uses explicit id after ownership check', async () => {
    const assertOwned = vi.fn();
    await expect(
      resolveRequirementVersionId({ versionId: 'ver-2', currentVersionId: 'ver-1', assertOwned }),
    ).resolves.toBe('ver-2');
    expect(assertOwned).toHaveBeenCalledWith('ver-2');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-api exec vitest run src/requirements/requirement-version.spec.ts`

Expected: FAIL

- [ ] **Step 3: 实现解析并接到 create/update**

DTO（create 与 update 都加）：

```ts
@IsOptional()
@ValidateIf((_, value) => value !== null)
@IsString()
@IsNotEmpty()
versionId?: string | null;
```

`RequirementsService.create`：在查到 `project` 后：

```ts
const versionId = await resolveRequirementVersionId({
  ...(Object.prototype.hasOwnProperty.call(dto, 'versionId') ? { versionId: dto.versionId } : {}),
  currentVersionId: project.currentVersionId,
  assertOwned: async (id) => {
    const owned = await this.prisma.projectVersion.findFirst({ where: { id, projectId: dto.projectId } });
    if (!owned) {
      throw new BadRequestException('Version does not belong to this project.');
    }
  },
});
```

`requirement.create` 的 `data` 增加 `versionId`。所有 requirement `include`（create/update/findAll/findOne）加上：

```ts
version: { select: { id: true, name: true } },
```

`update` 仅当 `dto` 含 `versionId` 时写入（含 null 清空），不要在只改 priority 时动版本。先 `findOne` 拿到 `projectId`，再 `assertOwned`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter flowx-api exec vitest run src/requirements/requirement-version.spec.ts`

Expected: PASS。再跑 `pnpm --filter flowx-api test` 防止 include 改动弄破现有 spec。

- [ ] **Step 5: Commit（仅当用户授权）**

```bash
git add apps/api/src/requirements
git commit -m "$(cat <<'EOF'
feat(api): attach optional release version to requirements

EOF
)"
```

---

### Task 4: `flowx-local` MCP

**Files:**
- Modify: `packages/flowx-local/src/mcp.ts`
- Modify: `packages/flowx-local/src/mcp.test.ts`

**Interfaces:**
- Consumes: `GET /projects`（含 `currentVersion`、`versions`）、`POST /projects/:id/versions`、`PATCH /projects/:id`、`POST /requirements`
- Produces:
  - `flowx_list_projects` 每项含 `currentVersion: { id, name } | null`、`versions: { id, name }[]`
  - `flowx_create_project_version({ projectId, name, setAsCurrent?: boolean })`
  - `flowx_create_requirement` 增加可选 `versionId: string | null`

- [ ] **Step 1: 扩展工具列表与行为测试**

在 `identifies as flowx-local and registers the user-facing tools` 中，把 `flowx_create_project_version` 插在 `flowx_list_projects` 之后。

扩展现有 list/create 测试：GET `/projects` 的 fixture 加上：

```ts
currentVersion: { id: 'ver-1', name: '2.6.0' },
versions: [{ id: 'ver-1', name: '2.6.0' }],
```

断言 `listedPayload.projects[0]` 含同样字段。

新增测试：

```ts
it('creates a project version and can set it current', async () => {
  // fetch mock:
  // POST /projects/proj_1/versions → { id: 'ver-2', name: '2.7.0', projectId: 'proj_1' }
  // PATCH /projects/proj_1 body { currentVersionId: 'ver-2' } when setAsCurrent true
});

it('forwards versionId including null on create_requirement', async () => {
  // POST /requirements body includes versionId: null
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/mcp.test.ts`

Expected: FAIL（工具列表缺新工具；summarize 无 currentVersion）。

- [ ] **Step 3: 实现**

`summarizeProjects` 每个项目增加：

```ts
currentVersion:
  project.currentVersion && typeof project.currentVersion === 'object'
    ? {
        id: String((project.currentVersion as Record<string, unknown>).id ?? ''),
        name: String((project.currentVersion as Record<string, unknown>).name ?? ''),
      }
    : null,
versions: (Array.isArray(project.versions) ? project.versions : []).map((row) => {
  const version = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  return { id: typeof version.id === 'string' ? version.id : '', name: typeof version.name === 'string' ? version.name : '' };
}),
```

注册：

```ts
server.registerTool(
  'flowx_create_project_version',
  {
    title: 'Create FlowX Project Version',
    description:
      'Create a release version on a FlowX project. For local intake, pass setAsCurrent=true only after the user chose to create a new version instead of using the current one.',
    inputSchema: z.object({
      projectId: z.string().min(1),
      name: z.string().min(1),
      setAsCurrent: z.boolean().optional(),
    }),
  },
  async (input) => {
    const { client } = await resolveSession(options.homeDir);
    return runRequest(async () => {
      const created = await client.request(`/projects/${encodeURIComponent(input.projectId)}/versions`, {
        method: 'POST',
        body: JSON.stringify({ name: input.name }),
      });
      if (input.setAsCurrent === true && created && typeof created === 'object' && 'id' in created) {
        await client.request(`/projects/${encodeURIComponent(input.projectId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ currentVersionId: (created as { id: string }).id }),
        });
      }
      return created;
    });
  },
);
```

`flowx_create_requirement` 的 zod 增加 `versionId: z.string().min(1).nullable().optional()`。POST body 仅当 `versionId !== undefined` 时加入该字段（含 `null`）：

```ts
...(input.versionId !== undefined ? { versionId: input.versionId } : {}),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowx-ai/local test`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户授权）**

```bash
git add packages/flowx-local/src/mcp.ts packages/flowx-local/src/mcp.test.ts
git commit -m "$(cat <<'EOF'
feat(local): expose project versions on intake MCP tools

EOF
)"
```

---

### Task 5: `flowx-mcp` 镜像

**Files:**
- Modify: `packages/flowx-mcp/src/flowx-api-client.ts`
- Modify: `packages/flowx-mcp/src/tools.ts`
- Modify: `packages/flowx-mcp/src/tools.test.ts`

**Interfaces:** 与 Task 4 相同工具名和入参。

- [ ] **Step 1: 扩展 `tools.test.ts`**

现有 `lists projects and creates requirements` fixture 加上 `currentVersion` / `versions`，断言 summarize 输出包含它们。新增 `createProjectVersion` + `setAsCurrent` 以及 `createRequirement` 转发 `versionId: null` 的用例。工具注册列表若有断言，插入 `flowx_create_project_version`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-mcp exec vitest run src/tools.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现客户端与 handler**

`FlowXApiClient` 增加：

```ts
createProjectVersion(projectId: string, body: { name: string }) {
  return this.request(`/projects/${encodeURIComponent(projectId)}/versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

setProjectCurrentVersion(projectId: string, currentVersionId: string | null) {
  return this.request(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ currentVersionId }),
  });
}
```

`createRequirement` body 类型增加 `versionId?: string | null`。

`tools.ts` 的 `summarizeProjects` 与 local 包保持同一字段。`flowx_create_project_version` handler：先 `createProjectVersion`，若 `setAsCurrent === true` 再 `setProjectCurrentVersion(projectId, created.id)`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter flowx-mcp test`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户授权）**

```bash
git add packages/flowx-mcp
git commit -m "$(cat <<'EOF'
feat(mcp): mirror project version intake tools

EOF
)"
```

---

### Task 6: intake Skill 版本门禁

**Files:**
- Modify: `packages/flowx-local/templates/flowx-intake-requirement/SKILL.md`
- Modify: `packages/flowx-local/src/setup.test.ts`

**Interfaces:** Skill 文本是安装源；`setup` 把它写到 `~/.cursor/skills/flowx-intake-requirement/SKILL.md` 等路径。

- [ ] **Step 1: 扩展 setup 测试（先失败）**

在 `packages/flowx-local/src/setup.test.ts` 的 force/write 断言旁增加：

```ts
expect(readFileSync(cursorIntake, 'utf8')).toContain('用当前版本');
expect(readFileSync(cursorIntake, 'utf8')).toContain('flowx_create_project_version');
expect(readFileSync(cursorIntake, 'utf8')).toContain('禁止省略');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts`

Expected: FAIL

- [ ] **Step 3: 改 Skill 模板**

把「必须流程」改成（保留选项目、收齐字段、启动确认；在选项目与创建之间插入版本门禁）：

```markdown
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
   （保持原文：摘要、userConfirmedStart、禁止未确认启动）

6. **启动后分支**  
   （保持原文）
```

「禁止」列表增加：

```markdown
- 未展示并确认发布版本即 `flowx_create_requirement`
- 省略 `versionId` 靠服务端默认当前版本
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowx-ai/local exec vitest run src/setup.test.ts`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户授权）**

```bash
git add packages/flowx-local/templates/flowx-intake-requirement/SKILL.md packages/flowx-local/src/setup.test.ts
git commit -m "$(cat <<'EOF'
feat(local): require release version confirmation in intake skill

EOF
)"
```

---

### Task 7: Web 契约与项目页

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/components/ProjectVersionsPanel.tsx`
- Create: `apps/web/src/components/ProjectVersionsPanel.test.tsx`
- Modify: `apps/web/src/pages/ProjectsPage.tsx`
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx`

**Interfaces:**
- `ProjectVersionSummary { id: string; name: string }`
- `Project` 增加 `currentVersionId?: string | null`、`currentVersion?: ProjectVersionSummary | null`、`versions?: ProjectVersionSummary[]`
- `Requirement` 增加 `versionId?: string | null`、`version?: ProjectVersionSummary | null`
- `api.listProjectVersions` / `createProjectVersion` / `updateProjectVersion` / `deleteProjectVersion` / `updateProjectCurrentVersion`

- [ ] **Step 1: 写 `ProjectVersionsPanel` 失败测试**

jsdom 测试：mock `api.listProjectVersions` 返回 `[{ id: 'ver-1', name: '2.6.0' }]`，`getProject` 返回 `currentVersionId: 'ver-1'`。渲染后面板文案含 `2.6.0` 与「当前」。点击删除时因当前版本，按钮 disabled 或文案含「当前版本」。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-web exec vitest run src/components/ProjectVersionsPanel.test.tsx`

Expected: FAIL

- [ ] **Step 3: 实现类型、api 与面板**

`types.ts`：

```ts
export interface ProjectVersionSummary {
  id: string;
  name: string;
}
```

`Project` / `Requirement` 按 Interfaces 补字段。

`api.ts`（靠近 `getProject`）：

```ts
listProjectVersions: (projectId: string) =>
  request<ProjectVersionSummary[]>(`/projects/${projectId}/versions`),
createProjectVersion: (projectId: string, payload: { name: string }) =>
  request<ProjectVersionSummary>(`/projects/${projectId}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
updateProjectVersion: (projectId: string, versionId: string, payload: { name: string }) =>
  request<ProjectVersionSummary>(`/projects/${projectId}/versions/${versionId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
deleteProjectVersion: (projectId: string, versionId: string) =>
  request<{ ok: true }>(`/projects/${projectId}/versions/${versionId}`, { method: 'DELETE' }),
updateProjectCurrentVersion: (projectId: string, currentVersionId: string | null) =>
  request<Project>(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ currentVersionId }),
  }),
```

`ProjectVersionsPanel`：Card + 列表 + 新建 Input + 设为当前 + 改名 + 删除。当前版本或仍被需求引用时删除按钮 `disabled`，title 用「仍是当前版本」或「仍有需求引用」（若面板拿不到引用计数，删除失败时用 API 409 文案 toast）。设为当前调用 `updateProjectCurrentVersion`。

`ProjectsPage` 的 badges 在 `project.code` 后插入：

```tsx
{project.currentVersion ? <Badge variant="secondary">{project.currentVersion.name}</Badge> : null}
```

`ProjectDetailPage` 同样加 Badge，并在简报/Code Review 网格旁或需求表上方渲染 `<ProjectVersionsPanel projectId={projectId} currentVersionId={project.currentVersionId} />`。需求表增加「版本」列：`requirement.version?.name ?? ''`（空则渲染空单元格，不写「未设置」）。表头旁加 Select 按 `versionId` 前端过滤，选项含「全部版本」与 `project.versions`。

- [ ] **Step 4: 跑测试**

Run: `pnpm --filter flowx-web exec vitest run src/components/ProjectVersionsPanel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户授权）**

```bash
git add apps/web/src/types.ts apps/web/src/api.ts apps/web/src/components/ProjectVersionsPanel.tsx apps/web/src/components/ProjectVersionsPanel.test.tsx apps/web/src/pages/ProjectsPage.tsx apps/web/src/pages/ProjectDetailPage.tsx
git commit -m "$(cat <<'EOF'
feat(web): manage and show project release versions

EOF
)"
```

---

### Task 8: Web 需求页

**Files:**
- Modify: `apps/web/src/pages/RequirementsPage.tsx`
- Modify: `apps/web/src/pages/RequirementsPage.test.tsx`
- Modify: `apps/web/src/pages/RequirementDetailPage.tsx`
- Modify: `apps/web/src/components/RequirementSchedulingPanel.tsx`

常量：`const UNVERSIONED = '__unversioned__';`

- [ ] **Step 1: 扩展 RequirementsPage 测试**

`requirement.project` 加上 `currentVersionId: 'ver-1'`、`currentVersion: { id: 'ver-1', name: '2.6.0' }`、`versions: [{ id: 'ver-1', name: '2.6.0' }]`。`requirement` 加上 `version: { id: 'ver-1', name: '2.6.0' }`。断言列表出现 `2.6.0`。

再测：打开「网页创建」，选项目后提交，`createRequirement` 被调用时 `versionId === 'ver-1'`。选「不挂版本」时 `versionId === null`。实现时若 Select 交互在 jsdom 不稳定，至少断言列表 Badge；创建默认值用单测提取的 submit handler 或直接断言 mock 调用。优先做列表 Badge + 提交 payload。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter flowx-web exec vitest run src/pages/RequirementsPage.test.tsx`

Expected: FAIL（无 `2.6.0`）

- [ ] **Step 3: 实现页面**

列表 badges 在优先级后插入：`item.version ? <Badge variant="outline">{item.version.name}</Badge> : null`。

创建 draft 增加 `versionId: string`（默认 `UNVERSIONED`）。选项目时：

```ts
versionId: project.currentVersionId ?? UNVERSIONED,
```

选完项目后渲染版本 Select：选项为「不挂版本」(`UNVERSIONED`) + `project.versions`。提交：

```ts
versionId: createDraft.versionId === UNVERSIONED ? null : createDraft.versionId,
```

`createRequirement` / `RequirementPayload` / `updateRequirement` 增加 `versionId?: string | null`。

需求详情 `DetailHeader` badges 在 priority 后插入版本（有才显示）。

`RequirementSchedulingPanel` 增加版本 Select，选项同样含 `UNVERSIONED`。`savePlanningMeta` 增加 `versionId`。需要 `requirement.project.versions`；若详情未带，mount 时 `api.listProjectVersions(requirement.project.id)`。

- [ ] **Step 4: 跑 Web 测试**

Run: `pnpm --filter flowx-web test`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户授权）**

```bash
git add apps/web/src/pages apps/web/src/components/RequirementSchedulingPanel.tsx apps/web/src/api.ts apps/web/src/types.ts
git commit -m "$(cat <<'EOF'
feat(web): assign release versions on requirements

EOF
)"
```

---

### Task 9: 文档与手册镜像

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `apps/web/public/user-manual.md`
- Modify: `docs/local-agent-guide.md`
- Modify: `apps/web/public/local-agent-guide.md`
- Modify: `docs/system-design.md`
- Modify: `docs/edge-agent-operations.md`（若仍写 intake 三步且未提版本）

- [ ] **Step 1: 改用户手册**

`docs/user-manual.md` 步骤 5 改为：列出项目 → **确认发布版本（用当前 / 新建）** → 创建需求 → 确认后启动。网页兜底字段列表增加「发布版本（默认项目当前版本，可改为其他已有版本或不挂）」。项目说明补一句：项目详情可管理版本清单并标记当前版本。

- [ ] **Step 2: 改本地 Agent 指南**

`docs/local-agent-guide.md` §4.0 在步骤 2 与 3 之间插入版本确认；工具表增加 `flowx_create_project_version`；写明 `flowx_create_requirement` 必须带确认后的 `versionId`。

- [ ] **Step 3: 改系统设计**

`docs/system-design.md` §4 数据链路改为：

```text
Workspace
  -> Project
     -> ProjectVersion (currentVersionId)
     -> Requirement (versionId?)
```

模块表 `projects` 职责补「发布版本清单」。

- [ ] **Step 4: 同步 public 镜像并校验**

```bash
cp docs/user-manual.md apps/web/public/user-manual.md
cp docs/local-agent-guide.md apps/web/public/local-agent-guide.md
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

Expected: `cmp` 无输出、退出码 0。`git diff --check` 无错误。

- [ ] **Step 5: 回归受影响测试**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm --filter @flowx-ai/local test
pnpm --filter flowx-mcp test
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit（仅当用户授权）**

```bash
git add docs apps/web/public/user-manual.md apps/web/public/local-agent-guide.md
git commit -m "$(cat <<'EOF'
docs: document project release versions and intake confirmation

EOF
)"
```

---

## Spec coverage

| Spec | Task |
| --- | --- |
| `ProjectVersion` 实体、当前版本、需求可空 FK | 1, 2, 3 |
| 版本 CRUD / 重名 409 / 删除约束 / 跨项目 400 | 2 |
| 创建需求省略/null/显式 ID | 3 |
| GET 项目带 currentVersion + 轻量 versions | 2, 4 |
| Skill 硬门禁、新建并 setAsCurrent | 6, 4 |
| MCP 三工具变化 | 4, 5 |
| Web 展示、版本卡片、需求 Select、创建表单不新建 | 7, 8 |
| 手册 / 系统设计 | 9 |
| 非目标（多版本、Bug、甘特、semver、状态机） | 无任务，禁止做 |

## 执行注意

Task 1 的 SQLite `RedefineTables` 必须与当时 `schema.prisma` 列完全一致。若 `Requirement`/`Project` 在写计划后已增列，先读 schema 再写 INSERT。Task 2 的 `PATCH /projects/:id` 不要在漏传字段时清空当前版本。
