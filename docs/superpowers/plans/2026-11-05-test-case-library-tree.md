# 测试用例库树状筛选与快速新建功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在测试用例库页面增加“用例库 → 模块”左侧树状筛选，并支持从模块节点快速打开预填库和模块的新建用例弹窗。

**Architecture:** 继续由 `QualityCasesPage` 管理 URL 筛选、用例库列表、模块缓存和树交互；树使用现有扁平 `TestCaseModule[]` 的 `parentId` 递归渲染，不引入新的业务组件依赖。扩展 `CreateCaseDialog` 接收可选初始库/模块，在打开时初始化表单；API、Prisma、本地包和协议保持不变。

**Tech Stack:** React 19, TypeScript, React Router, Tailwind, lucide-react, Vitest + jsdom。

---

## 文件变更地图

- Modify: `apps/web/src/pages/quality/QualityCasesPage.tsx`
  - 读取 `moduleId` URL 筛选。
  - 管理模块按库缓存、展开状态、加载错误和快速创建上下文。
  - 渲染左侧“全部用例 → 用例库 → 模块”树，移除重复的用例库下拉筛选。
  - 选择节点时维护 `libraryId/moduleId/page`，把 `moduleId` 传给 `getTestCasesPage`。
- Modify: `apps/web/src/pages/quality/QualityDialogs.tsx`
  - 为 `CreateCaseDialog` 增加 `initialLibraryId?` 和 `initialModuleId?` props。
  - 弹窗每次打开时用初始上下文初始化库、模块，并在模块请求完成后保留有效的初始模块。
- Modify: `apps/web/src/pages/quality/QualityPages.test.tsx`
  - 增加树节点筛选、模块节点快速创建和创建成功刷新行为测试。
  - 扩展 mock 的用例库/模块/创建用例数据。
- Modify: `docs/user-manual.md`
  - 更新用例库操作描述，说明左侧树筛选和模块节点 `+` 快速新建。
- Modify: `apps/web/public/user-manual.md`
  - 同步源手册镜像。
- Modify: `CHANGELOG.md`
  - 在实施提交对应的未发布条目记录用户可见变化。

### Task 1: 为树筛选和快速创建写失败测试

**Files:**
- Modify: `apps/web/src/pages/quality/QualityPages.test.tsx`

- [x] **Step 1: 扩展测试数据和 mock**

在现有 `describe('Quality pages')` 的 `beforeEach` 中保留 `library` 和 `testCase`，增加一个共享库和子模块数据，并让 `api.createTestCase` 返回新用例：

```ts
const sharedLibrary: TestCaseLibrary = {
  id: 'library-2',
  workspaceId: workspace.id,
  scope: 'WORKSPACE',
  name: '共享回归库',
  status: 'ACTIVE',
};

const childModule = {
  id: 'module-2',
  libraryId: library.id,
  parentId: 'module-1',
  name: '登录恢复',
  sortOrder: 0,
  _count: { cases: 0, children: 0 },
};

vi.mocked(api.getTestCaseLibraries).mockResolvedValue([library, sharedLibrary]);
vi.mocked(api.getTestCaseModules).mockResolvedValue([
  {
    id: 'module-1',
    libraryId: library.id,
    parentId: null,
    name: '认证',
    sortOrder: 0,
    _count: { cases: 1, children: 1 },
  },
  childModule,
]);
vi.mocked(api.createTestCase).mockResolvedValue({
  ...testCase,
  id: 'case-2',
  moduleId: 'module-2',
  title: '新建登录恢复用例',
  module: { id: 'module-2', name: '登录恢复' },
});
```

- [x] **Step 2: 写树点击筛选的失败测试**

在 `Quality pages` describe 中新增测试，初始路径使用 `libraryId=library-1`，在测试文件中增加一个使用 `useLocation` 渲染 `data-testid="case-search"` 的路由包装，等待页面加载后点击模块节点按钮，断言该元素的 URL 搜索串和服务端分页请求：

```ts
it('通过左侧树按用例库和模块筛选，并把模块筛选透传到分页请求', async () => {
  await renderPage(
    '/quality/test-cases?workspaceId=workspace-1&libraryId=library-1',
    <QualityCasesPage />,
  );

  const moduleButton = Array.from(container.querySelectorAll('button')).find(
    (button) => button.getAttribute('aria-label') === '筛选模块：认证',
  );
  await act(async () => moduleButton?.click());

  expect(container.querySelector('[data-testid="case-search"]')?.textContent).toContain('libraryId=library-1');
  expect(container.querySelector('[data-testid="case-search"]')?.textContent).toContain('moduleId=module-1');
  expect(api.getTestCasesPage).toHaveBeenLastCalledWith(expect.objectContaining({
    libraryId: 'library-1',
    moduleId: 'module-1',
    page: 1,
  }));
});
```

测试第一次应因页面没有树节点而失败。

- [x] **Step 3: 写模块级快速创建的失败测试**

新增测试，点击模块右侧的 `+`，断言创建弹窗打开且库/模块选择器显示预填值：

```ts
it('从模块节点快速新建用例时预填所属用例库和模块', async () => {
  await renderPage(
    '/quality/test-cases?workspaceId=workspace-1&libraryId=library-1',
    <QualityCasesPage />,
  );

  const quickCreate = container.querySelector(
    'button[aria-label="在模块“认证”中新建用例"]',
  ) as HTMLButtonElement | null;
  await act(async () => quickCreate?.click());

  expect(document.body.textContent).toContain('新建测试用例');
  expect(document.body.querySelector('[aria-label="用例库"]')?.textContent).toContain('核心回归库');
  expect(document.body.querySelector('[aria-label="模块"]')?.textContent).toContain('认证');
});
```

测试第一次应因模块节点没有快速创建按钮而失败。

- [x] **Step 4: 写创建成功后的刷新/筛选失败测试**

在同一个测试文件中补充创建成功行为：填入标题、步骤和预期结果后点击“创建用例”，断言 `createTestCase` 使用 `module-1`，并且刷新后的分页请求仍带 `libraryId/moduleId`。

测试命令：

```bash
pnpm --filter flowx-web exec vitest run src/pages/quality/QualityPages.test.tsx
```

预期：新增测试失败，失败原因是目标树交互尚未实现。

### Task 2: 扩展创建弹窗的初始上下文

**Files:**
- Modify: `apps/web/src/pages/quality/QualityDialogs.tsx:298-445`

- [x] **Step 1: 为 `CreateCaseDialog` props 增加初始值**

将 props 扩展为：

```ts
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: TestCaseLibrary[];
  initialLibraryId?: string;
  initialModuleId?: string;
  onCreated: () => Promise<void>;
}
```

- [x] **Step 2: 在打开时初始化库和模块**

增加打开状态 effect；当传入库仍存在时优先使用传入库，否则回退到第一个库；模块初始值使用有效的 `initialModuleId`，否则为 `NO_MODULE`：

```ts
useEffect(() => {
  if (!open) return;
  const nextLibraryId = initialLibraryId && libraries.some((item) => item.id === initialLibraryId)
    ? initialLibraryId
    : libraries[0]?.id ?? '';
  setLibraryId(nextLibraryId);
  setModuleId(initialModuleId ?? NO_MODULE);
}, [initialLibraryId, initialModuleId, libraries, open]);
```

保留现有模块加载 effect，但将模块加载完成后的校验改为：只有当当前模块不在返回结果中时才回退到 `NO_MODULE`，以兼容快速创建的预填值。

- [x] **Step 3: 运行弹窗相关测试和 TypeScript 检查**

```bash
pnpm --filter flowx-web exec vitest run src/pages/quality/QualityPages.test.tsx
```

预期：仍因页面尚未传入初始 props 而失败，但不应出现 TypeScript 或 effect 无限循环错误。

### Task 3: 实现用例库 → 模块树和 URL 筛选

**Files:**
- Modify: `apps/web/src/pages/quality/QualityCasesPage.tsx`

- [x] **Step 1: 增加模块树状态和 URL 值**

新增 import：`useCallback`、`useMemo`，以及 `ChevronDown`、`ChevronRight`、`Folder`、`FolderOpen`、`Loader2`、`RotateCw`。读取：

```ts
const moduleId = searchParams.get('moduleId') ?? ALL;
```

新增状态：

```ts
const [modulesByLibrary, setModulesByLibrary] = useState<Record<string, TestCaseModule[]>>({});
const [moduleLoading, setModuleLoading] = useState<Record<string, boolean>>({});
const [moduleErrors, setModuleErrors] = useState<Record<string, string | null>>({});
const [expandedLibraries, setExpandedLibraries] = useState<Set<string>>(new Set());
const [caseCreateContext, setCaseCreateContext] = useState<{ libraryId?: string; moduleId?: string }>({});
```

同时把 `TestCaseModule` 类型加入 import。

- [x] **Step 2: 统一树筛选和模块加载函数**

增加 `selectTreeNode`：

```ts
function selectTreeNode(nextLibraryId?: string, nextModuleId?: string) {
  updateQuery({
    libraryId: nextLibraryId ?? null,
    moduleId: nextModuleId ?? null,
    page: null,
  });
}
```

增加 `loadModules(libraryId, force = false)`，若缓存存在且非强制刷新则直接展开；请求 `api.getTestCaseModules(libraryId)`，成功写入缓存并清除该库错误，失败写入错误消息并保留现有列表。使用 `useCallback` 或稳定依赖，避免树渲染触发重复请求。

新增 effect：当当前 `libraryId` 对应库存在且尚未展开时自动展开并加载模块；模块节点点击前确保所属库已展开。

- [x] **Step 3: 将模块筛选传入分页请求并校验失效 URL**

在 `refreshList` 的 `api.getTestCasesPage` 参数中加入：

```ts
moduleId: moduleId === ALL ? undefined : moduleId,
```

在库列表加载完成后，如果 URL 的 `libraryId` 不在当前库列表，清除 `libraryId/moduleId/page`；如果当前库被切换或 `moduleId` 与所选库不匹配，清除 `moduleId/page`。校验应使用已缓存模块数据，避免因模块尚未加载而误清除合法 URL。

- [x] **Step 4: 渲染递归树节点**

在页面组件内增加固定签名的 `renderModuleTree(libraryId, modules, parentId, depth)` 递归函数，按 `parentId` 过滤并按 `sortOrder/name` 排序。每个模块输出：

```tsx
<div key={module.id} style={{ paddingLeft: depth * 12 }}>
  <div className="flex items-center gap-1">
    <button
      type="button"
      aria-label={`筛选模块：${module.name}`}
      onClick={() => selectTreeNode(libraryId, module.id)}
    >
      <Folder aria-hidden="true" className="h-4 w-4" />
      <span>{module.name}</span>
    </button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`在模块“${module.name}”中新建用例`}
      onClick={() => {
        setCaseCreateContext({ libraryId, moduleId: module.id });
        setCaseDialogOpen(true);
      }}
    >
      <Plus aria-hidden="true" className="h-3.5 w-3.5" />
    </Button>
  </div>
  {renderModuleTree(libraryId, modules, module.id, depth + 1)}
</div>
```

库节点提供展开/收起按钮、库筛选按钮、错误重试和空模块提示。树顶部提供“全部用例”按钮，点击清除 `libraryId/moduleId`；库和模块选中态使用 `aria-current="page"` 或现有 token class，确保键盘和屏幕阅读器可识别。

- [x] **Step 5: 调整布局和工具栏**

将 `CardContent` 内现有 `ListToolbar` 与列表包在 `grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]` 中。左侧树使用现有 Card/边框 token，右侧保留搜索、工作区、范围和优先级筛选，移除重复的“按用例库筛选” `Select`。列表标题按当前树节点名称显示，例如“认证 · 测试用例”。

保留顶部新建库、模块管理、批量导入和通用新建用例按钮；通用新建用例打开时设置 `caseCreateContext` 为当前库（如果选中库）或空对象，并传递给 `CreateCaseDialog`。模块级 `+` 传入具体库和模块。

- [x] **Step 6: 运行 Task 1 测试**

```bash
pnpm --filter flowx-web exec vitest run src/pages/quality/QualityPages.test.tsx
```

预期：树筛选、快速创建和刷新测试通过；原有查看、编辑、删除、导入、模块管理测试仍通过。

### Task 4: 同步手册与镜像

**Files:**
- Modify: `docs/user-manual.md:331`
- Modify: `apps/web/public/user-manual.md:331`

- [x] **Step 1: 更新源手册**

在用例库说明开头加入：左侧“全部用例 → 用例库 → 模块”树是主筛选入口，点击库或模块切换右侧列表，模块节点右侧 `+` 可直接打开预填所属库和模块的新建用例弹窗；搜索、优先级和分页仍在右侧工具栏。

- [x] **Step 2: 同步镜像并校验**

将同样文本写入 `apps/web/public/user-manual.md`，运行：

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
```

预期：命令退出码为 0。

### Task 5: 完整验证、变更记录与提交

**Files:**
- Modify: `CHANGELOG.md`
- All changed Web files above

- [x] **Step 1: 运行 Web 测试**

```bash
pnpm --filter flowx-web test
```

预期：所有 Vitest 测试通过。

- [x] **Step 2: 运行 Web 构建和文档/差异检查**

```bash
pnpm --filter flowx-web build
cmp -s docs/user-manual.md apps/web/public/user-manual.md
git diff --check
```

预期：构建成功、手册镜像一致、无空白错误。

- [x] **Step 3: 更新 CHANGELOG**

在 `CHANGELOG.md` 的未发布条目增加已实施的用户可见变化，说明左侧树状筛选和模块级快速新建已可用，并保留已有的设计记录条目语义。

- [x] **Step 4: 检查变更范围**

```bash
git status --short
git diff --stat
```

确认只有页面、弹窗测试、手册镜像和 `CHANGELOG.md` 变化，没有生成物、数据库或无关格式化。

- [x] **Step 5: 提交实现**

```bash
git add apps/web/src/pages/quality/QualityCasesPage.tsx \\
  apps/web/src/pages/quality/QualityDialogs.tsx \\
  apps/web/src/pages/quality/QualityPages.test.tsx \\
  docs/user-manual.md apps/web/public/user-manual.md CHANGELOG.md
git commit -m "优化测试用例库树状筛选与快速创建"
```

预期：提交成功，提交信息使用中文。
