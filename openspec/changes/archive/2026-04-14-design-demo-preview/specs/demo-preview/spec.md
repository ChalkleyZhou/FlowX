## ADDED Requirements

### Requirement: Demo 部署触发

Design 阶段 AI 生成 Demo 并写入工作分支后，系统 MUST 自动触发目标仓库的部署。部署 MUST 复用现有 `DeployService.createJob`，使用仓库的 `RepositoryDeployConfig` 配置。部署 MUST 在工作分支上触发，branch 参数为当前工作分支名。

#### Scenario: 自动触发 Demo 部署
- **WHEN** AI 成功生成 demoPages 且代码已写入目标仓库工作分支
- **THEN** 系统调用 DeployService.createJob，传入 repositoryId、branch（工作分支）、commitSha，创建 DeployJobRecord

#### Scenario: 仓库未配置部署
- **WHEN** 目标仓库的 RepositoryDeployConfig.enabled 为 false 或不存在
- **THEN** 系统跳过部署触发，Demo 代码仅存储为 artifact，IdeationDesignPanel 展示"未配置部署"提示

#### Scenario: 部署触发失败
- **WHEN** DeployService.createJob 抛出异常
- **THEN** 系统记录错误日志，Demo 代码已存储为 artifact，IdeationDesignPanel 展示"部署失败"状态

### Requirement: 预览 URL 管理

部署成功后，系统 MUST 将 `DeployJobRecord.externalJobUrl` 关联到对应的 IdeationArtifact。该 URL MUST 可通过 IdeationArtifact 的 content.previewUrl 字段获取。

#### Scenario: 部署成功获取预览 URL
- **WHEN** DeployJobRecord 状态为 TRIGGERED 且 externalJobUrl 有值
- **THEN** 系统更新 IdeationArtifact 的 content.previewUrl 为 externalJobUrl

#### Scenario: 部署无 URL 返回
- **WHEN** DeployJobRecord 状态为 TRIGGERED 但 externalJobUrl 为空（如 noop provider）
- **THEN** previewUrl 为空，前端降级展示代码视图

### Requirement: 前端预览展示

IdeationDesignPanel MUST 新增 Demo 预览区域。当存在 previewUrl 时，MUST 通过 iframe 展示部署后的 Demo 页面。当部署进行中时，MUST 展示部署状态指示（部署中/已就绪/失败）。当无 previewUrl 时，MUST 展示"在新窗口打开"链接或代码视图降级。

#### Scenario: 预览 URL 可用时展示 iframe
- **WHEN** IdeationArtifact 存在且 content.previewUrl 有值
- **THEN** IdeationDesignPanel 在 Design 内容下方展示 iframe，src 为 previewUrl，提供"新窗口打开"链接

#### Scenario: 部署进行中展示状态
- **WHEN** Design 阶段 AI 生成完成，部署已触发但 DeployJobRecord 尚未返回 URL
- **THEN** IdeationDesignPanel 展示"部署中..."动画和 DeployJobRecord 状态

#### Scenario: 无预览 URL 降级展示
- **WHEN** 部署失败或仓库未配置部署
- **THEN** IdeationDesignPanel 展示 Demo 代码视图（语法高亮），提示用户配置部署或手动查看

### Requirement: 预览状态轮询

前端 MUST 在 Design 阶段 AI 生成完成后轮询部署状态，直到获取 previewUrl 或超时。轮询间隔 MUST 不低于 3 秒，超时时间 MUST 不低于 5 分钟。轮询 MUST 在用户离开页面时停止。

#### Scenario: 轮询获取到预览 URL
- **WHEN** 前端开始轮询 DeployJobRecord 状态
- **THEN** 每隔 3 秒查询一次，当 externalJobUrl 有值时停止轮询并展示 iframe

#### Scenario: 轮询超时
- **WHEN** 轮询超过 5 分钟仍未获取到 previewUrl
- **THEN** 停止轮询，展示"部署超时，请稍后手动查看"提示，保留手动刷新按钮

#### Scenario: 用户离开页面停止轮询
- **WHEN** 用户从需求详情页导航离开
- **THEN** 轮询 interval 被清除，不再发起请求
