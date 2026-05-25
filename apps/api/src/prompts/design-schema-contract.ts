import designGenerationSchema from '../ai/design-generation.output.schema.json';

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
