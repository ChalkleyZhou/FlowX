# OpenDesign 启动前操作引导弹框设计

**Date:** 2026-07-27  
**Status:** Approved for planning  
**Scope:** 在工作流详情点击「打开本地构思」或「打开本地 OpenDesign」时，先弹出带截图的两步操作引导，确认后再拉起本地 OpenDesign。

## Goal

降低首次使用 OpenDesign 获取 FlowX 任务的门槛：用户在启动前就知道要选目录、输入什么话，减少「应用已打开但不知道下一步」的困惑。

## Decisions

| 主题 | 选择 |
| --- | --- |
| 时机 | 点击入口后、真正调用本地启动**之前** |
| 入口 | 「打开本地构思」与「打开本地 OpenDesign」共用同一套引导 |
| 配图 | 基于用户提供的 Open Design 实机截图，裁成两张并加轻量标注 |
| 不再提示 | 本变更不做 |
| 自动填入 prompt | 不做；用户仍在 OpenDesign 内手动输入 |

## User flow

1. 用户点击「打开本地构思」或「打开本地 OpenDesign」
2. Web 弹出引导 Dialog（此时**不**调用 `launchOpenDesignLocal`）
3. 用户阅读两步说明与配图
4. 点击「继续打开 OpenDesign」→ 执行现有启动逻辑（claim / bridge / toast）
5. 点击「取消」或关闭 → 不启动

## Dialog content

**标题：** 如何在 OpenDesign 中获取 FlowX 任务  

**副标题：** 按下面两步操作，再继续打开 OpenDesign  

**步骤 1**
- 文案：`选择项目目录（根据实际情况按需选择）`
- 配图：截图中「选择工作目录」区域，轻量标注

**步骤 2**
- 文案：`输入“获取FlowX任务”并发送`
- 配图：截图中主输入框与「发送」按钮区域，轻量标注；可显示示例文案「获取FlowX任务」

**底部按钮**
- 主按钮：`继续打开 OpenDesign`
- 次按钮：`取消`

## Images

- 源图：用户提供的 Open Design 主页截图（含「选择工作目录」与输入「获取FlowX任务」）
- 产出：
  - `apps/web/public/open-design-guide-step1.png` — 目录选择
  - `apps/web/public/open-design-guide-step2.png` — 输入并发送
- 标注风格：简洁框选/箭头 + 短标签，与现有管理台视觉一致；避免大面积遮挡关键控件

## Architecture

```text
[打开本地构思 / 打开本地 OpenDesign]
        │
        ▼
  setGuideOpen(true)   // 不启动
        │
        ▼
  Dialog（步骤 + 配图）
        │
   ┌────┴────┐
取消/关闭   继续打开
   │           │
   ▼           ▼
 关闭弹框   launchLocalOpenDesign*
            （现有 claim + launchOpenDesignLocal）
```

两个入口共用一个 Dialog 状态；确认后根据入口类型调用对应 launch 函数。

## Implementation surface

| 位置 | 职责 |
| --- | --- |
| `apps/web/src/pages/WorkflowRunDetailPage.tsx` | 入口改点开引导；确认后再 launch |
| 可选轻量组件 `OpenDesignLaunchGuideDialog.tsx` | 弹框 UI（若页面内联过大则抽出） |
| `apps/web/public/open-design-guide-step{1,2}.png` | 引导配图 |
| `WorkflowRunDetailPage.test.tsx` | 可见性与是否调用 launch |
| `docs/user-manual.md` / `docs/local-agent-guide.md` + public 镜像 | 一句说明打开前有引导 |

## Non-goals

- localStorage「下次不再提示」
- 修改 `flowx-local` 或 OpenDesign 应用本身
- 自动向 OpenDesign 注入 prompt
- 构思与设计两套不同引导文案（本变更共用）

## Testing

- 点构思入口 / 设计入口：出现引导；未确认前 `launchOpenDesignLocal` 未被调用
- 「继续打开 OpenDesign」：调用对应启动路径
- 「取消」：关闭且不启动
- 弹框文案含两步说明与「获取FlowX任务」

## Documentation

手册中本地 OpenDesign / 本地构思段落补充：打开前平台会展示两步操作引导（选目录、输入「获取FlowX任务」）。
