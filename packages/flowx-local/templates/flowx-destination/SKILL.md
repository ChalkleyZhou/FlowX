---
name: flowx-destination
description: 任何要把内容写入 FlowX、且可能落到多个项目或容器的操作，都先确认去向。已记住时只问是否继续在该处；没有则列出项目，再列出该操作对应的版本或用例库。已绑定具体工作流、工作项或执行会话时不重新选择。不要猜测工作区或共享库。
---

# FlowX 操作去向

写入 FlowX 之前先确定落点。项目是唯一锚点，工作区由项目带出，不单独选择。同一类操作再确认一个容器。已有明确对象时不再选项目。

## 何时使用

用户要在 FlowX 新建、上传、导入或登记，且请求没有点名具体工作流、工作项、执行会话或用例库。需求发起、用例上传以及其他会新建平台记录的操作都走这里。其他技能不要自己猜项目。

已经拿到服务器返回的 `workflowRunId`、`workItemId`、`executionSessionId`，或用户点名了某一条已有记录时，直接用该对象，不读去向缓存。

## 记住的去向

文件：`~/.flowx/destination.json`

```json
{
  "projectId": "",
  "projectName": "",
  "slots": {
    "version": { "id": "", "name": "" },
    "caseLibrary": { "id": "", "name": "" }
  }
}
```

只保存这些字段。文件缺失、项目不存在，或本次要用的槽位缺失时，只补问缺失的那一层。

槽位：

- `version`：需求、问题和缺陷
- `caseLibrary`：测试用例

## 必须流程

1. **已记住就只确认一次**
   项目和本次槽位都有效时，只问：**是否继续在 {projectName} 的 {slotName}？**
   - 同意：使用缓存的 id。
   - 不同意：清掉用户要换的那一层；换项目时连槽位一起清掉，再从第 2 步开始。
   同一批操作复用这次确认。下一次新的写入请求重新问这句。

2. **没有项目时列出项目**
   调用 `flowx_list_projects`，展示项目名称，等用户选定 `projectId`。禁止用本地目录、仓库或聊天记录猜测。

3. **再确定槽位**
   - `version`：用 `flowx_list_projects` 的 `resource=versions` 列出版本，并指出 `currentVersion`。有当前版本时选项是 **用当前版本** / **选择其他版本** / **新建版本**。没有当前版本时必须选已有版本或新建。用户点名版本名就用已有 id。新建前先问名称，调用 `flowx_create_project_version`；只有用户明确要求时才 `setAsCurrent: true`。
   - `caseLibrary`：用 `projectId` 调用 `flowx_list_case_libraries`，展示库名和用例数。用户选已有库，或先给出名称再新建。没有库时不要替用户起名。
   必须等用户选择。

4. **写入缓存后再调用业务工具**
   确认后更新 `~/.flowx/destination.json`。新建版本或用例库要等工具返回 id，再把槽位 id 和名称写回。
   用例写入使用 `flowx_create_test_case`，必须带 `projectId`，并且只带 `libraryId` 或 `newLibraryName` 其中一个。需求创建必须带确认过的 `versionId`。工具拒绝时不要改走其他接口，也不要退回工作区共享库。
