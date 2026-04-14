## ADDED Requirements

### Requirement: 用户可管理自己的 Cursor 凭据
系统 MUST 提供受会话认证保护的接口，用于按用户维度设置、更新、删除和查询 Cursor 凭据状态。系统 SHALL 仅返回凭据配置状态，不返回任何明文凭据。

#### Scenario: 用户设置凭据
- **WHEN** 已登录用户提交有效的 Cursor API Key
- **THEN** 系统 SHALL 将密钥加密后存储到该用户凭据记录，并返回 `configured=true`

#### Scenario: 用户查询凭据状态
- **WHEN** 已登录用户请求凭据状态
- **THEN** 系统 SHALL 返回该用户是否已配置凭据及最近更新时间，不包含明文密钥

#### Scenario: 用户删除凭据
- **WHEN** 已登录用户发起删除凭据请求
- **THEN** 系统 SHALL 删除该用户的凭据记录并返回 `configured=false`

### Requirement: Cursor 执行必须支持用户级凭据优先
当工作流使用 Cursor provider 执行时，系统 MUST 按照凭据优先级进行认证：用户凭据优先，实例级 `CURSOR_API_KEY` 次之，CLI 登录态最后。

#### Scenario: 用户凭据存在时优先使用
- **WHEN** 工作流发起用户已配置有效 Cursor 凭据
- **THEN** 系统 SHALL 在该次 CLI 子进程调用中注入用户级 `CURSOR_API_KEY`，且不依赖实例级共享凭据

#### Scenario: 用户凭据不存在时回退实例级凭据
- **WHEN** 用户未配置 Cursor 凭据且实例级 `CURSOR_API_KEY` 已配置
- **THEN** 系统 SHALL 回退使用实例级凭据继续执行

#### Scenario: 用户凭据与实例级凭据都不存在时回退登录态
- **WHEN** 用户凭据缺失且实例级 `CURSOR_API_KEY` 为空
- **THEN** 系统 SHALL 继续尝试 CLI 登录态认证路径，并在失败时返回可操作错误

### Requirement: 凭据处理过程必须可审计且不泄漏敏感信息
系统 MUST 记录凭据写入、删除和执行来源决策的审计事件，并确保日志中不得出现明文密钥。

#### Scenario: 凭据更新审计
- **WHEN** 用户更新或删除凭据
- **THEN** 系统 SHALL 记录包含用户标识、操作类型、时间戳的审计事件

#### Scenario: 执行来源审计
- **WHEN** 系统执行 Cursor CLI
- **THEN** 系统 SHALL 记录本次使用的凭据来源类型（`user` / `instance` / `login-state`），不记录密钥值

#### Scenario: 认证失败错误分类
- **WHEN** 发生凭据缺失、解密失败或 Cursor CLI 认证失败
- **THEN** 系统 SHALL 返回区分原因的错误消息与错误码，以支持前端引导和运维排障
