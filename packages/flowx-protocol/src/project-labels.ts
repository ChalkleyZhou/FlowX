export const PROJECT_LABEL_COLORS = ['GRAY', 'BLUE', 'CYAN', 'GREEN', 'AMBER', 'ORANGE', 'RED', 'PURPLE'] as const;
export type ProjectLabelColor = (typeof PROJECT_LABEL_COLORS)[number];
export interface ProjectLabelSummary { id: string; name: string; color: ProjectLabelColor }

export function normalizeProjectLabelName(value: unknown): string {
  if (typeof value !== 'string' || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) throw new Error('标签名称不能包含换行或控制字符');
  const name = value.trim().normalize('NFC');
  if ([...name].length < 1 || [...name].length > 30) throw new Error('标签名称须为 1–30 个字符');
  return name;
}

export function parseProjectLabelIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim() || id.includes(','))) throw new Error('labelIds 必须为非空标签 ID 数组');
  const ids = [...new Set(value as string[])];
  if (ids.length > 20) throw new Error('最多选择 20 个标签');
  return ids;
}

export function parseProjectLabelFilter(value: unknown): string[] {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string') throw new Error('labelIds 查询必须为逗号分隔字符串');
  return parseProjectLabelIds(value.split(','));
}
