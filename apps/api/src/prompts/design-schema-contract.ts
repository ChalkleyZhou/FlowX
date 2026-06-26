import designGenerationSchema from '../ai/design-generation.output.schema.json';
import designSpecSchema from '../ai/design-spec.output.schema.json';

/**
 * Same file Codex uses for `--output-schema`; keeps Cursor prompts aligned with CLI validation.
 */
export function getDesignJsonSchemaContractBlock(): string {
  const body = JSON.stringify(designGenerationSchema);
  return [
    '下列 JSON Schema 与后端/Codex CLI 使用的 design-generation.output.schema.json 为同一份定义。',
    '你只输出一个能通过该校验的 JSON 对象；顶层含 design、demo、demoPages（至少两页：入口+场景）。禁止 Markdown、禁止代码围栏。',
    '',
    body,
  ].join('\n');
}

/**
 * Cursor CLI does not enforce `--output-schema`; embedding the full schema balloons the prompt and often yields
 * truncated / invalid JSON (e.g. literal `...`). Validation still happens server-side via {@link assertStrictGenerateDesignOutput}.
 */
export function getDesignJsonSchemaSummaryContractBlock(): string {
  return [
    '【字段契约摘要 — Cursor 专用：不嵌入完整 Schema 全文，避免提示过长导致输出截断或非 JSON 省略号。】',
    '只输出一个 JSON 对象；顶层键必须为 design、demo、demoPages（缺一不可）。禁止 Markdown、禁止用 ``` 围栏包裹。',
    '严禁在 JSON 任意位置使用英文句号三连「...」或「省略」「同上」「下方略」代替真实字段；componentCode 必须是完整字符串（可换行转义）。',
    '',
    'design: { overview, pages: [≥1 项 { name, route, layout, keyComponents[], interactions[] }], demoScenario, designRationale }',
    'demo: { summary, flows: [{ name, goal, entry, states[] }], scope: { included[], excluded[] }, knownGaps[] }',
    'demoPages: [≥2 项；入口页含可选 navLabel（主导航文案）+ { route, componentName, componentCode, mockData, filePath }]',
  ].join('\n');
}

/**
 * 设计阶段（OpenDesign 高保真）完整 Schema：与后端 {@link assertDesignSpecOutput} 和 Codex `--output-schema` 一致。
 */
export function getDesignSpecSchemaContractBlock(): string {
  const body = JSON.stringify(designSpecSchema);
  return [
    '下列 JSON Schema 与后端校验 (design-spec.output.schema.json) 为同一份定义。',
    '你只输出一个能通过该校验的 JSON 对象；顶层含 design、demo、designArtifact。designArtifact.html 必须是完整单页 HTML 文档。禁止 Markdown、禁止代码围栏。本阶段不要求 demoPages。',
    '',
    body,
  ].join('\n');
}

/** 设计阶段字段契约摘要 — Cursor 专用（不嵌入完整 Schema 全文）。 */
export function getDesignSpecSchemaSummaryContractBlock(): string {
  return [
    '【字段契约摘要 — Cursor 专用：设计阶段（高保真 HTML），不嵌入完整 Schema 全文。】',
    '只输出一个 JSON 对象；顶层键必须为 design、demo、designArtifact（缺一不可）。禁止 Markdown、禁止用 ``` 围栏包裹。',
    '严禁用「...」「省略」「同上」代替真实内容；designArtifact.html 必须是完整 HTML 字符串（换行转义），可直接在 sandbox iframe 渲染。本阶段不要求 demoPages。',
    '',
    'design: { overview, pages: [≥1 项 { name, route, layout, keyComponents[], interactions[] }], demoScenario, designRationale }',
    'demo: { summary, flows: [{ name, goal, entry, states[] }], scope: { included[], excluded[] }, knownGaps[] }',
    'designArtifact: { html: 完整单页 HTML 文档（<!doctype html> 起始，内联 CSS，无外部依赖） }',
  ].join('\n');
}
