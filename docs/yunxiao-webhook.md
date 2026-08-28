# 云效 Webhook 钉钉通知接入

FlowX 可以接收阿里云云效自动化规则发送的 Webhook，按事件中的人员标识匹配当前 FlowX 组织成员，再通过钉钉应用工作通知发送个人 Markdown 消息。

## 前置条件

- 当前 FlowX 组织由钉钉登录创建，并具有有效的 `providerOrganizationId`。
- API 已配置 `DINGTALK_APP_ID`、`DINGTALK_APP_SECRET` 和 `DINGTALK_AGENT_ID`。
- 管理员已在“用户管理”中同步钉钉用户。此功能只依赖用户资料，不依赖部门或组织架构。

## 获取接收地址和 Secret

组织管理员使用当前登录 Bearer Token 调用：

```http
GET /api/yunxiao-webhooks/config
Authorization: Bearer <FlowX 登录 Token>
```

首次调用会为当前组织创建配置，响应示例：

```json
{
  "id": "cm123",
  "webhookSecret": "generated-secret",
  "isActive": true,
  "endpointPath": "/yunxiao-webhooks/cm123/events",
  "createdAt": "2026-08-28T07:00:00.000Z",
  "updatedAt": "2026-08-28T07:00:00.000Z"
}
```

云效中填写的完整地址为：

```text
https://<FlowX 域名>/api/yunxiao-webhooks/cm123/events
```

请求方式选择 `POST`，并配置以下请求头：

```text
Content-Type: application/json
X-FlowX-Webhook-Secret: generated-secret
```

不要把 Secret 放进消息正文、事件 ID或查询参数。

## 请求体

在云效自动化规则中，将云效提供的变量映射为以下 JSON。变量名以云效页面实际可选字段为准：

```json
{
  "eventId": "workitem-42-status-changed-20260828T150000",
  "recipient": {
    "dingtalkUserId": "manager0123",
    "unionId": "union-id",
    "email": "zhangsan@example.com",
    "account": "zhangsan",
    "name": "张三"
  },
  "title": "云效任务状态变更",
  "markdown": "任务 **支付回调异常处理** 已进入待处理状态。",
  "url": "https://devops.aliyun.com/workitem/42"
}
```

字段约束：

- `eventId` 必填，同一条逻辑事件必须稳定且唯一。推荐组合工作项 ID、事件类型和变更时间。
- `recipient` 必填，内部至少提供一个非空标识。
- `title`、`markdown` 必填；`url` 可选，只允许 `http` 或 `https` 地址。
- 接收人匹配顺序为：`dingtalkUserId`、`unionId`、`email`、`account`、`name`。
- `name` 只有在当前组织内唯一时才会使用；重名时 FlowX 返回 `422`，不会猜测接收人。

不需要的接收人字段可以省略。建议优先传 `dingtalkUserId` 或 `unionId`；只有云效规则无法提供钉钉身份时，再使用邮箱或账号。

## 响应与重试

首次成功投递：

```json
{
  "accepted": true,
  "duplicate": false,
  "deliveryId": "cm456",
  "matchedBy": "email"
}
```

同一 `eventId` 已发送成功时，FlowX 返回成功但不再次发送：

```json
{
  "accepted": true,
  "duplicate": true,
  "deliveryId": "cm456",
  "status": "SENT"
}
```

- `401`：配置不存在、已停用或 Secret 不正确。
- `400`：请求字段不完整或格式错误。
- `422`：组织未连接钉钉、找不到成员或匹配到多个成员。
- `502`：钉钉发送失败。云效可使用相同 `eventId` 重试；失败、无匹配和歧义记录允许重新处理，已成功记录不会重复发送。

组织管理员可查看最近 100 条投递记录：

```http
GET /api/yunxiao-webhooks/deliveries
Authorization: Bearer <FlowX 登录 Token>
```

Secret 泄露后可立即轮换：

```http
POST /api/yunxiao-webhooks/config/rotate-secret
Authorization: Bearer <FlowX 登录 Token>
```

轮换后必须同步更新云效规则中的 `X-FlowX-Webhook-Secret`。
