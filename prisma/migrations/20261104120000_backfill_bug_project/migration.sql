-- 审查发现转出的历史缺陷没有项目。按来源需求补上，使它们出现在对应项目的缺陷列表里。
UPDATE "Bug"
SET "projectId" = (
  SELECT "Requirement"."projectId"
  FROM "Requirement"
  WHERE "Requirement"."id" = "Bug"."requirementId"
)
WHERE "projectId" IS NULL
  AND "requirementId" IS NOT NULL;

UPDATE "Bug"
SET "projectId" = (
  SELECT "Requirement"."projectId"
  FROM "WorkflowRun"
  INNER JOIN "Requirement" ON "Requirement"."id" = "WorkflowRun"."requirementId"
  WHERE "WorkflowRun"."id" = "Bug"."workflowRunId"
)
WHERE "projectId" IS NULL
  AND "workflowRunId" IS NOT NULL;
