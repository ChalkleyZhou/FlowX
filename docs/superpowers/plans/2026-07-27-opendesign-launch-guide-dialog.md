# OpenDesign 启动前操作引导弹框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击「打开本地构思」或「打开本地 OpenDesign」时先弹出带两步截图引导的 Dialog，用户确认后再执行现有本地启动逻辑。

**Architecture:** 抽出轻量 `OpenDesignLaunchGuideDialog`；页面用 `openDesignGuideKind: null | 'brainstorm' | 'design'` 控制弹框。确认后分别调用现有 `launchLocalOpenDesignBrainstorm` / `launchLocalOpenDesign`。配图由用户提供的 Open Design 截图裁剪标注后放入 `apps/web/public/`。

**Tech Stack:** React、Radix Dialog（现有 `components/ui/dialog`）、Vitest、静态 PNG

**Spec:** `docs/superpowers/specs/2026-07-27-opendesign-launch-guide-dialog-design.md`

**Source screenshot (for Task 1):**  
`/Users/chalkley/.cursor/projects/Users-chalkley-workspace-FlowX/assets/image-d998ab65-0b41-4172-b82d-aee2ac519495.png`

---

## File map

| File | Responsibility |
| --- | --- |
| `apps/web/public/open-design-guide-step1.png` | 步骤1：选择工作目录示意 |
| `apps/web/public/open-design-guide-step2.png` | 步骤2：输入「获取FlowX任务」示意 |
| `apps/web/src/components/OpenDesignLaunchGuideDialog.tsx` | 引导弹框 UI |
| `apps/web/src/components/OpenDesignLaunchGuideDialog.test.tsx` | 弹框文案与按钮回调 |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | 入口改开引导；确认后再 launch |
| `apps/web/src/pages/WorkflowRunDetailPage.test.tsx` | 入口不立即 launch；确认后 launch |
| `docs/user-manual.md` + `apps/web/public/user-manual.md` | 一句引导说明 |
| `docs/local-agent-guide.md` + `apps/web/public/local-agent-guide.md` | 一句引导说明 |

---

### Task 1: 裁剪并标注引导配图

**Files:**
- Create: `apps/web/public/open-design-guide-step1.png`
- Create: `apps/web/public/open-design-guide-step2.png`

- [ ] **Step 1: Inspect source image dimensions**

```bash
file "/Users/chalkley/.cursor/projects/Users-chalkley-workspace-FlowX/assets/image-d998ab65-0b41-4172-b82d-aee2ac519495.png"
sips -g pixelWidth -g pixelHeight "/Users/chalkley/.cursor/projects/Users-chalkley-workspace-FlowX/assets/image-d998ab65-0b41-4172-b82d-aee2ac519495.png"
```

- [ ] **Step 2: Produce two annotated crops**

用 Python（Pillow）或 `sips` + 简单叠加，从源图生成：

1. `open-design-guide-step1.png`：裁到下方「选择工作目录」控件附近；在该控件上画圆角矩形框选，旁注「选择工作目录」。
2. `open-design-guide-step2.png`：裁到中央输入区（含「获取FlowX任务」与「发送」）；框选输入框与发送按钮，旁注「输入并发送」。

标注颜色用管理台主色近似（如 `#7C3AED` 描边 + 半透明填充），线宽适中，不要遮住控件文字。

若 Pillow 未安装：

```bash
python3 -m pip install pillow --user
```

脚本可写在临时文件 `/tmp/make-od-guide-images.py`，跑完即可删；**不要**把脚本提交进仓库。

示例骨架（坐标需按实际分辨率微调）：

```python
from PIL import Image, ImageDraw, ImageFont

src = Image.open(
    "/Users/chalkley/.cursor/projects/Users-chalkley-workspace-FlowX/assets/image-d998ab65-0b41-4172-b82d-aee2ac519495.png"
).convert("RGBA")

def annotate_crop(box, highlight, label, out_path):
    crop = src.crop(box).convert("RGBA")
    overlay = Image.new("RGBA", crop.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    x0, y0, x1, y1 = highlight
    draw.rounded_rectangle([x0, y0, x1, y1], radius=12, outline=(124, 58, 237, 255), width=4)
    draw.rectangle([x0, max(0, y0 - 28), x0 + 8 + 12 * len(label), y0 - 4], fill=(124, 58, 237, 230))
    draw.text((x0 + 6, y0 - 24), label, fill=(255, 255, 255, 255))
    Image.alpha_composite(crop, overlay).convert("RGB").save(out_path, "PNG", optimize=True)

# TODO: 根据 sips 得到的宽高，手工量好 box / highlight 后填入
# annotate_crop(..., out_path="apps/web/public/open-design-guide-step1.png")
# annotate_crop(..., out_path="apps/web/public/open-design-guide-step2.png")
```

生成后用 Read 工具打开两张 PNG，确认标注位置正确、文字可读。

- [ ] **Step 3: Commit images**

```bash
git add apps/web/public/open-design-guide-step1.png apps/web/public/open-design-guide-step2.png
git commit -m "$(cat <<'EOF'
assets(web): add OpenDesign launch guide step images

EOF
)"
```

---

### Task 2: `OpenDesignLaunchGuideDialog` 组件 + 单测

**Files:**
- Create: `apps/web/src/components/OpenDesignLaunchGuideDialog.tsx`
- Create: `apps/web/src/components/OpenDesignLaunchGuideDialog.test.tsx`

- [ ] **Step 1: Write failing component tests**

```tsx
// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenDesignLaunchGuideDialog } from './OpenDesignLaunchGuideDialog';

describe('OpenDesignLaunchGuideDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders two steps and prompt copy when open', () => {
    act(() => {
      root.render(
        <OpenDesignLaunchGuideDialog
          open
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    });
    const text = container.textContent ?? '';
    expect(text).toContain('如何在 OpenDesign 中获取 FlowX 任务');
    expect(text).toContain('选择项目目录（根据实际情况按需选择）');
    expect(text).toContain('输入“获取FlowX任务”并发送');
    expect(text).toContain('获取FlowX任务');
    expect(container.querySelector('img[alt*="选择项目目录"]')).toBeTruthy();
    expect(container.querySelector('img[alt*="获取FlowX任务"]')).toBeTruthy();
  });

  it('calls onConfirm when continue is clicked', () => {
    const onConfirm = vi.fn();
    act(() => {
      root.render(
        <OpenDesignLaunchGuideDialog
          open
          onOpenChange={() => undefined}
          onConfirm={onConfirm}
        />,
      );
    });
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('继续打开 OpenDesign'),
    );
    expect(button).toBeTruthy();
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenChange(false) when cancel is clicked', () => {
    const onOpenChange = vi.fn();
    act(() => {
      root.render(
        <OpenDesignLaunchGuideDialog
          open
          onOpenChange={onOpenChange}
          onConfirm={() => undefined}
        />,
      );
    });
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('取消'),
    );
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter flowx-web exec vitest run src/components/OpenDesignLaunchGuideDialog.test.tsx
```

- [ ] **Step 3: Implement the dialog**

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

type OpenDesignLaunchGuideDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
};

export function OpenDesignLaunchGuideDialog({
  open,
  onOpenChange,
  onConfirm,
  confirmDisabled = false,
}: OpenDesignLaunchGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>如何在 OpenDesign 中获取 FlowX 任务</DialogTitle>
          <DialogDescription>按下面两步操作，再继续打开 OpenDesign</DialogDescription>
        </DialogHeader>

        <ol className="space-y-5 text-sm text-foreground">
          <li className="space-y-2">
            <p className="font-medium">1. 选择项目目录（根据实际情况按需选择）</p>
            <img
              src="/open-design-guide-step1.png"
              alt="OpenDesign 中选择项目目录"
              className="w-full rounded-md border border-border"
            />
          </li>
          <li className="space-y-2">
            <p className="font-medium">2. 输入“获取FlowX任务”并发送</p>
            <img
              src="/open-design-guide-step2.png"
              alt="OpenDesign 中输入获取FlowX任务并发送"
              className="w-full rounded-md border border-border"
            />
          </li>
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>
            继续打开 OpenDesign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run component tests — PASS**

```bash
pnpm --filter flowx-web exec vitest run src/components/OpenDesignLaunchGuideDialog.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/OpenDesignLaunchGuideDialog.tsx \
  apps/web/src/components/OpenDesignLaunchGuideDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add OpenDesign launch guide dialog component

EOF
)"
```

---

### Task 3: 接入 WorkflowRunDetailPage

**Files:**
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.tsx`
- Modify: `apps/web/src/pages/WorkflowRunDetailPage.test.tsx`

- [ ] **Step 1: Write / update page tests (TDD)**

在 mock 已有 `launchOpenDesignLocal` 的前提下新增：

```tsx
it('shows OpenDesign guide before launching brainstorm and only launches on confirm', async () => {
  vi.mocked(api.getWorkflowRun).mockResolvedValue(
    createWorkflowRun({
      status: 'BRAINSTORM_PENDING',
      stageExecutions: [
        {
          id: 'stage-brainstorm',
          stage: 'BRAINSTORM',
          status: 'PENDING',
          statusMessage: null,
          attempt: 1,
          output: null,
        },
      ],
    }),
  );
  vi.mocked(api.retryOpenDesignBrainstormHandoff).mockResolvedValue({
    ticket: 'ticket-1',
    loopbackPort: 3920,
  } as never);
  vi.mocked(probeFlowxLocal).mockResolvedValue(true);
  vi.mocked(launchOpenDesignLocal).mockResolvedValue({ opened: true } as never);

  await renderPage();

  const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('打开本地构思'),
  );
  await act(async () => {
    openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });

  expect(container.textContent).toContain('如何在 OpenDesign 中获取 FlowX 任务');
  expect(launchOpenDesignLocal).not.toHaveBeenCalled();
  expect(api.retryOpenDesignBrainstormHandoff).not.toHaveBeenCalled();

  const continueButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('继续打开 OpenDesign'),
  );
  await act(async () => {
    continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(api.retryOpenDesignBrainstormHandoff).toHaveBeenCalledWith('workflow-1');
  expect(launchOpenDesignLocal).toHaveBeenCalled();
});

it('does not launch OpenDesign when guide is cancelled', async () => {
  vi.mocked(api.getWorkflowRun).mockResolvedValue(
    createWorkflowRun({
      status: 'DESIGN_PENDING',
      stageExecutions: [
        {
          id: 'stage-design',
          stage: 'DESIGN',
          status: 'PENDING',
          statusMessage: null,
          attempt: 1,
          output: null,
        },
      ],
    }),
  );

  await renderPage();
  const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('打开本地 OpenDesign'),
  );
  await act(async () => {
    openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });

  const cancelButton = Array.from(container.querySelectorAll('button')).find((button) =>
    elIsGuideCancel(button),
  );
  // helper: text includes 取消 and is inside the open guide dialog — or just find 取消 after guide opened
  await act(async () => {
    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });

  expect(launchOpenDesignLocal).not.toHaveBeenCalled();
  expect(api.retryOpenDesignHandoff).not.toHaveBeenCalled();
});

function elIsGuideCancel(button: Element) {
  return button.textContent?.trim() === '取消';
}
```

若现有用例直接点「打开本地构思」并断言立刻 launch，改为：先确认引导，或改为测引导出现。核对 `createWorkflowRun` / handoff mock 形状与页面真实 API 返回一致（读现有成功用例）。

- [ ] **Step 2: Run page tests — expect FAIL**

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
```

- [ ] **Step 3: Wire the page**

1. Import `OpenDesignLaunchGuideDialog`。
2. 增加状态：

```tsx
const [openDesignGuideKind, setOpenDesignGuideKind] = useState<'brainstorm' | 'design' | null>(null);
```

3. 改 actions：

```tsx
onClick: () => setOpenDesignGuideKind('brainstorm'),
// ...
onClick: () => setOpenDesignGuideKind('design'),
```

4. 在 JSX 中（与其它 Dialog 并列）挂载：

```tsx
<OpenDesignLaunchGuideDialog
  open={openDesignGuideKind !== null}
  onOpenChange={(open) => {
    if (!open) setOpenDesignGuideKind(null);
  }}
  confirmDisabled={openDesignBusy}
  onConfirm={() => {
    const kind = openDesignGuideKind;
    setOpenDesignGuideKind(null);
    if (kind === 'brainstorm') {
      void launchLocalOpenDesignBrainstorm();
    } else if (kind === 'design') {
      void launchLocalOpenDesign();
    }
  }}
/>
```

保持 `launchLocalOpenDesign` / `launchLocalOpenDesignBrainstorm` 函数体不变。

- [ ] **Step 4: Run page tests — PASS**

```bash
pnpm --filter flowx-web exec vitest run src/pages/WorkflowRunDetailPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/WorkflowRunDetailPage.tsx apps/web/src/pages/WorkflowRunDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): show OpenDesign launch guide before local open

EOF
)"
```

---

### Task 4: 文档同步

**Files:**
- `docs/user-manual.md` + `apps/web/public/user-manual.md`
- `docs/local-agent-guide.md` + `apps/web/public/local-agent-guide.md`

- [ ] **Step 1: Add one-sentence guide note**

在本地构思 / OpenDesign 相关段落补充：

> 点击「打开本地构思」或「打开本地 OpenDesign」时，平台会先弹出两步操作引导（选择项目目录、输入「获取FlowX任务」），确认后再打开应用。

- [ ] **Step 2: Sync mirrors + cmp**

```bash
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/user-manual.md apps/web/public/user-manual.md \
  docs/local-agent-guide.md apps/web/public/local-agent-guide.md
git commit -m "$(cat <<'EOF'
docs: mention OpenDesign launch guide dialog

EOF
)"
```

注意：若工作区已有用户未提交的 `docs/local-agent-guide.md` 改动，只追加本引导句子，不要回滚或覆盖无关修改。

---

### Task 5: 收尾验证

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter flowx-web exec vitest run \
  src/components/OpenDesignLaunchGuideDialog.test.tsx \
  src/pages/WorkflowRunDetailPage.test.tsx
cmp -s docs/user-manual.md apps/web/public/user-manual.md
cmp -s docs/local-agent-guide.md apps/web/public/local-agent-guide.md
```

Expected: all PASS / cmp exit 0

- [ ] **Step 2: Manual smoke（可选）**

1. 工作流在 `BRAINSTORM_PENDING` / `DESIGN_PENDING`
2. 点打开入口 → 见引导与两张图
3. 取消 → 不弹起 OpenDesign / 不发 handoff
4. 再点 → 继续打开 → 正常启动

---

## Spec coverage checklist

| Spec 要求 | Task |
| --- | --- |
| 启动前弹框 | Task 3 |
| 两入口共用 | Task 3 |
| 两步文案 | Task 2 |
| 真实截图裁切标注 | Task 1 |
| 确认后才 launch | Task 3 测试 |
| 取消不启动 | Task 3 测试 |
| 不做「不再提示」 | 无对应任务 |
| 手册一句 | Task 4 |

## Placeholder / consistency self-review

- 文案与 spec 一字对齐：标题、两步、主/次按钮
- 图片路径固定 `/open-design-guide-step1.png`、`/open-design-guide-step2.png`
- 不改 `flowx-local` / API
