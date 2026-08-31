# 云效 Webhook 钉钉通知接入

FlowX 接收云效 Projex 自动化规则发送的原生“工作项数据”，根据负责人匹配 FlowX 中已同步的钉钉用户，并发送个人工作通知。

## FlowX 配置

API 服务配置一个专用 Webhook Secret：

```env
YUNXIAO_WEBHOOK_SECRET="请使用随机且不可猜测的值"
```

该 Secret 只用于验证云效 Webhook，不是个人 API Token，也不授予 FlowX 用户权限。

配置完成后，组织管理员需要在 FlowX「设置」→「云效集成」中填写云效 `organizationIdentifier` 并启用云效通知。停用不会删除配置和历史投递记录，重新启用即可恢复。未配置 Secret 或云效组织绑定时不能启用集成。

## 云效配置

在云效 Projex 自动化规则中选择 Webhook 动作并填写：

```text
Webhook URL: https://<FlowX 域名>/api/yunxiao-webhooks
HTTP Method: POST
Secret: 与 YUNXIAO_WEBHOOK_SECRET 相同
Webhook Body: 工作项数据
```

Webhook 地址继续使用固定地址；云效组织与 FlowX 组织的绑定由 FlowX 页面控制。

设置 Secret 后，云效会自动增加请求头：

```text
X-Projex-Signature: <Secret>
```

FlowX 严格校验该请求头，无需在 URL、Body 或自定义 Header 中放置个人 Token。云效官方协议说明见[《Webhook配置指南》](https://help.aliyun.com/zh/yunxiao/user-guide/webhook-configuration-guide)。

## 用户匹配

FlowX 从工作项的 `assignedTo` 读取负责人：

1. 优先尝试用 `assignedTo.id` 或 `assignedTo.identifier` 匹配 FlowX 用户账号。
2. 再用 `assignedTo.name`、`assignedTo.realName`、`assignedTo.displayName` 或 `assignedTo.nickName` 精确匹配 FlowX 用户姓名。
3. 只考虑已加入钉钉组织且未停用的 FlowX 用户。
4. 只在绑定的 FlowX 组织内匹配负责人；找不到组织绑定、找不到用户或存在重名时返回 `422`，不会猜测接收人或误发消息。

因此，接入前应先由管理员在 FlowX“用户管理”中完成钉钉用户同步。若云效负责人姓名和钉钉通讯录姓名不同，应统一姓名或将云效用户 ID 维护为对应 FlowX 账号。

## 消息内容与重试

钉钉消息根据云效原生字段生成，包含：

- 工作项标题 `subject`
- 编号 `serialNumber`
- 项目 `space.name`
- 状态 `status.displayName` 或 `status.name`
- 负责人 `assignedTo.name`
- 工作项链接（请求中存在合法 `url` 或 `webUrl` 时）

FlowX 使用工作项 `id` 与 `gmtModified`（或 `updateStatusAt`）组成事件 ID。相同事件重试不会重复发送；钉钉发送失败时允许云效使用同一事件再次重试。

常见响应：

- `200`：发送成功，或相同事件已经处理。
- `400`：缺少工作项 ID、标题或负责人。
- `401`：`X-Projex-Signature` 缺失或不正确。
- `422`：找不到负责人或匹配到多个 FlowX 用户。
- `502`：钉钉发送失败，可重试。
- `503`：FlowX 未配置 `YUNXIAO_WEBHOOK_SECRET`。
