---
name: flowx-local-smoke
description: 在 FlowX 本地冒烟阶段，多开发者按目标端领取用例、执行验证、上传证据并回传可聚合结果。
---

# FlowX 本地冒烟

在用户要求执行或协作完成 FlowX 本地冒烟时使用。

1. 已有轮次时调用 `flowx_list_smoke_tasks`；只有明确要新建轮次时才调用 `flowx_create_smoke_run`。服务端会从已完成开发证据锁定默认代码 revision。
2. 选定目标端和用例后调用 `flowx_claim_smoke_task`。只执行响应中本次租约分配的用例；租约冲突或过期时重新领取，不要沿用旧 session 回传。
3. 在返回的目标 revision 上执行用例。保留实际环境、耗时和 `PASSED`、`FAILED`、`BLOCKED` 或 `SKIPPED` 结论。
4. 日志、截图、视频、JUnit 和 coverage 等资料先通过 `flowx_upload_artifact` 上传。若显示 `queued: true`，先执行 `flowx-local sync` 并确认上传成功。
5. 调用 `flowx_submit_smoke_report`，传入领取时的 `executionSessionId`、`sourceFingerprint`，以及实际验证的完整 `testedRevisions`、本次用例结果和已上传 Artifact ID。每次完成使用稳定且唯一的 `idempotencyKey`。

不要替其他开发者覆盖结果。服务端保留每次执行明细并按阻断优先级聚合；最终提测报告由 FlowX Web 在全部必测门禁满足后生成。
