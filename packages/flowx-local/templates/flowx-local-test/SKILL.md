---
name: flowx-local-test
description: 在用户明确要求执行 FlowX 功能测试或缺陷回归时，领取指定范围，真实执行并逐例回传结果与证据。兼容独立的旧冒烟流程。
---

# FlowX 本地功能测试与回归

1. 调用 `flowx_list_test_tasks` 发现有权限的任务；按项目和版本筛选，再读取对应轮次及快照。没有任务时先准备需求测试设计与提测，不自行绕过准备门禁。可通过 `flowx_list_case_libraries`、`flowx_list_case_modules` 和 `flowx_list_test_cases` 发现范围，`flowx_create_test_design` 准备设计，`flowx_generate_test_design` 生成后用 `flowx_get_test_design` 查看。根据用户决策，用 `flowx_update_test_candidate` 逐项处理候选，用 `flowx_update_test_smoke` 编辑完整冒烟范围；不得批量自动设为 `ACCEPTED`，不得自行确认设计。每次修改后重新读取最新 `revision`；冒烟只发送 DTO 可写字段，剔除 `testDesignId`、`sortOrder` 和时间戳，保留 `precondition:null`。候选用例的 `proposedCase` 要保留 `testData`（可为 `null`）和 `targetKeys`，复用候选不得丢失原始内容；冒烟 DTO 不支持这两个字段，不要加入。展示处理后的范围、覆盖检查与未覆盖项，仅在用户明确确认后调用 `flowx_confirm_test_design`。随后用 `flowx_test_requests` 的 list/get 动作发现并读取提测单；用户要求新建时才用 create，完整参数放在 `request`。仅在用户明确要求准备提测时，以 get 返回的最新 `scopeRevision` 调用 prepare；创建后不得自动 prepare，准备成功也不代表开始测试或测试通过。
2. 如果 IDE 启动交接已带 `executionSessionId`，直接复用已领取范围，禁止再次领取。否则用户确认目标端和范围后，调用 `flowx_claim_test_task`。保留返回的 `executionSessionId`、`testRunRevision`、`sourceFingerprint`、代码基线与租约；只执行本次分配用例。
3. 核对本地仓库和实际代码版本，按快照中的测试数据、步骤与预期真实执行。脚本生成不代表已执行；没有环境或工具时如实报告 `BLOCKED` 或 `SKIPPED` 及原因，不伪造通过。
4. 使用 `flowx_upload_artifact` 上传日志、截图、视频或测试框架报告，指定领取的会话。返回 queued 时先运行 `flowx-local sync` 并确认上传成功。
5. 调用 `flowx_report_test_progress` 分批保存实际结果，每批使用独立且稳定的幂等键；网络重试保留同键与同内容，不能修改已接受结果。长任务调用 `flowx_control_test_execution` 的 heartbeat 续租；过期后重新领取，禁止用旧会话回传。
6. 全部领取用例有终态结果后调用 `flowx_submit_test_report` 完成会话。测试失败仍可结束执行，不等于测试通过。
7. 用户停止测试时先停止设备操作，再 release 或 cancel 剩余范围；服务端取消不会终止本机进程。使用 `flowx_test_reports` 查看历史或生成阶段报告；最终报告需用户要求结束轮次后以最新 revision 调用 `flowx_finish_test_run`；不会把阻塞或未测用例改成通过。`flowx_test_reports` 的 request 动作必须明确 `runIds`、`baseline`，回归替代关系通过 `supersessions` 声明。
8. 缺陷修复完成后创建独立 `REGRESSION` 轮次，关联 `sourceBugId`，不覆盖初测事实。可以用 `flowx_link_test_bug` 将本项目已有缺陷关联到失败用例结果，支持完成后补关联。旧 `flowx-local-smoke` 和四个 smoke 工具继续只做原有冒烟。

服务端或本地版本不支持时明确报告升级要求，不自动用冒烟工具代替功能测试。更新本地包后重新加载 IDE 的 FlowX MCP。
