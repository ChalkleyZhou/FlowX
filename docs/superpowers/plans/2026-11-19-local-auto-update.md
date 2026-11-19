# flowx-local 自动更新实施计划

**目标：** 实现已确认的调用触发检查、后台安装和下次启动生效。

**架构：** 稳定 bootstrap 选择不可变版本；独立 worker 持有跨进程锁并安装校验；CLI、MCP 和服务只做轻量活动通知。服务父进程只处理版本切换和信号，不参与业务协议。

**技术栈：** Node.js 20+、TypeScript、Vitest、现有 npm/Skill/MCP 能力。

- [x] 更新存储：在 `packages/flowx-local/src/update-store.ts` 实现安装隔离、原子 JSON、有效版本选择与开发模式判断；`update-store.test.ts` 先覆盖有效/损坏指针和禁止降级。
- [x] 更新 worker：在 `auto-update.ts` 实现五分钟缓存、独立 owner 记录的 bakery 进程锁、npm CLI 定位、安装校验和异步触发；`auto-update.test.ts` 先覆盖并发、离线、失败不切换、稳定版校验和开发关闭。安装通过 `node npm-cli.js install --prefix <stage> --ignore-scripts --engine-strict --no-audit --no-fund --registry https://registry.npmjs.org @flowx-ai/local@<version>`。
- [x] 启动集成：原 `index.ts` 命令逻辑移入 `cli.ts`，稳定 `index.ts` 选择 `cli.js` 后启动；`update` 等待 worker，`status` 补充版本状态；MCP 通过 transport 消息通知触发，服务通过 request 活动触发。先补入口、MCP 和服务生命周期测试。
- [x] 模板兼容：`update.ts` 刷新已安装且未自定义的 Skill；MCP 只刷新已有配置，保持原稳定入口。先用临时 home 验证保留自定义 Skill/其他 MCP 配置。
- [x] 文档和验收：更新 README、本地指南、运维说明、用户手册、镜像和 CHANGELOG；执行 `pnpm --filter @flowx-ai/local test`、`pnpm --filter @flowx-ai/local build`、`pnpm check`、`git diff --check` 和手册 `cmp`。不进行 npm 发布或修改真实 `~/.flowx`。


## 验收记录（2026-11-19）

- 本地包测试：34 文件、224 项全部通过；包含真实 CLI/stdio MCP/daemon 生命周期、六进程争抢，以及旧恢复锁交错导致双进程同时进入的红绿回归。
- 本地包构建通过；`git diff --check` 和两份用户手册镜像 `cmp` 通过。
- 已执行 `pnpm check`：全仓构建、Web 449 项、protocol 17 项、Cursor extension 77 项通过；API 1298 项中一项原型归档预算测试在全仓并发负载下超时，其余 1297 项通过。随后单独复跑该文件，37 项全部通过（超时用例约 6.5 秒）。上一轮并发超时的两组 Git 测试也已单独复跑，19 项全部通过。未修改这些 API 测试或放宽其超时。
- 本地适配：需要适配 CLI、MCP、daemon、Skill 刷新和稳定启动路径，本次均已交付；API/Web/protocol 业务契约复用现有能力，无新增业务接口。
- 实机验证环境为 macOS + Node 20；Windows/Linux 尚未实机验证。未发布 npm、未改真实 `~/.flowx`、未执行 Git 提交。
