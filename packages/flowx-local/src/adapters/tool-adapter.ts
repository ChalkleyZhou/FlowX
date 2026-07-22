export const TOOL_ADAPTER_CAPABILITIES = [
  'context-import',
  'artifact-export',
  'completion-report',
] as const;

export type ToolAdapterCapability = (typeof TOOL_ADAPTER_CAPABILITIES)[number];

export interface ToolAdapter<TInput, TResult> {
  readonly name: string;
  readonly capabilities: readonly ToolAdapterCapability[];
  launch(input: TInput): Promise<TResult>;
}
