import brainstormOutputSchema from '../ai/brainstorm.output.schema.json';

/**
 * Single source of truth with Codex `exec --output-schema` (same JSON file on disk).
 * Injected into prompts so Cursor gets identical structural + semantic constraints without drift.
 */
export function getBrainstormJsonSchemaContractBlock(): string {
  // Single-line schema: same canonical object as the .json file, fewer prompt tokens for the model.
  const body = JSON.stringify(brainstormOutputSchema);
  return [
    '下列 JSON Schema 与后端/Codex CLI 校验使用的 brainstorm.output.schema.json 为同一份定义。',
    '你只输出一个能通过该校验的 JSON 对象：顶层仅含 brief；禁止把 brief 内字段摊平到根；禁止 Markdown、禁止代码围栏、禁止多余说明文字。',
    '',
    body,
  ].join('\n');
}
