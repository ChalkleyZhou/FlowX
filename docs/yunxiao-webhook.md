# 云效 Webhook 钉钉通知接入

FlowX 接收云效 Projex 自动化规则发送的原生“工作项数据”，通过云效项目成员 API 获取云效 `userId`，按管理员确认的映射匹配 FlowX 用户，并发送个人工作通知。

## FlowX 配置

API 服务配置一个专用 Webhook Secret：

```env
YUNXIAO_WEBHOOK_SECRET="请使用随机且不可猜测的值"
YUNXIAO_PERSONAL_ACCESS_TOKEN="云效个人访问令牌"
```

`YUNXIAO_WEBHOOK_SECRET` 只用于验证云效 Webhook；`YUNXIAO_PERSONAL_ACCESS_TOKEN` 用于调用云效成员 API，两者用途不同。

配置完成后，组织管理员需要在 FlowX「设置」→「云效集成」中填写云效 `organizationIdentifier` 并启用云效通知。停用不会删除配置和历史投递记录，重新启用即可恢复。未配置 Secret 或云效组织绑定时不能启用集成。

云效个人访问令牌通过 `Authorization: Bearer <TOKEN>` 调用标准项目成员接口 `GET /oapi/v1/projex/organizations/{organizationId}/projects/{projectId}/members`。个人 Token 继承创建人的云效权限，并受 Token 权限点和有效期限制。也兼容 `YUNXIAO_ACCESS_KEY_ID` 与 `YUNXIAO_ACCESS_KEY_SECRET`；两者同时配置时优先使用个人 Token。可选配置 `YUNXIAO_API_ENDPOINT`。未配置任何云效 API 凭据时，Webhook 仍会记录每个接收人的未匹配原因，但不会发送通知。

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

FlowX 默认从工作项读取以下通知对象：

- 负责人：`assignedTo`
- 参与者：`participants`、`participantList` 或 `participant`
- 验证者：`verifiers`、`verifier`、`verifyUsers`、`verifyUser`、`validators` 或 `validator`
- 创建者：`creator`

FlowX 使用工作项中的 `spaceIdentifier` 作为项目 ID，调用云效项目成员接口，先用通知对象的云效 `identifier` 匹配项目成员，再使用“设置”→“云效集成”中保存的云效 `userId` 映射匹配 FlowX 用户。个人 Token 接口不返回钉钉 ID，因此需要管理员先输入项目 ID、加载成员并逐个选择 FlowX 用户；同一个云效用户跨项目可以复用映射。使用 AccessKey 时仍兼容通过 `dingTalkId` 匹配已同步的钉钉身份。不会使用姓名猜测接收人；同一 FlowX 用户同时属于多个角色时只发送一次，投递记录会保留其全部角色。

每个通知对象的匹配结果都会保存。设置页“未匹配人员”区域会展示最近记录、云效 ID、角色、项目和原因，包括项目成员不存在、云效成员尚未手动关联、FlowX 用户不在当前组织以及 OpenAPI 调用失败。可选通知对象未匹配时会跳过，不影响其他已匹配人员；所有通知对象均无法匹配时返回 `422`。管理员完成关联后，下一次 Webhook 重试或工作项更新即可发送通知。

## 消息内容与重试

钉钉消息根据云效原生字段生成，包含：

- 工作项标题 `subject`
- 编号 `serialNumber`
- 项目 `space.name`
- 状态 `status.displayName` 或 `status.name`
- 负责人 `assignedTo.name`
- 工作项链接：优先使用请求中的合法 `url` 或 `webUrl`；缺少时根据项目/空间 ID、工作项类别和工作项 ID 自动生成云效 Projex 地址

FlowX 使用工作项 `id` 与 `gmtModified`（或 `updateStatusAt`）组成事件 ID，并按“组织 + 事件 + FlowX 接收人”记录幂等投递。相同事件重试不会重复通知已成功人员；多人通知中某个接收人发送失败时，其他人仍会继续发送，云效重试只会补发失败记录。

常见响应：

- `200`：发送成功，或相同事件已经处理。
- `400`：缺少工作项 ID、标题，或没有任何可解析的通知对象。
- `401`：`X-Projex-Signature` 缺失或不正确。
- `422`：所有通知对象均无法匹配，或某个人员匹配到多个 FlowX 用户。
- `502`：钉钉发送失败，可重试。
- `503`：FlowX 未配置 `YUNXIAO_WEBHOOK_SECRET`。
