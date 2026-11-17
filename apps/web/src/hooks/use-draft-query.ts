import { useState } from 'react';

/** 工具条上的搜索和筛选先改草稿，地址栏或已生效条件变化时再同步回来。 */
export function useDraftQuery<T extends Record<string, string>>(applied: T) {
  const key = JSON.stringify(applied);
  const [draft, setDraft] = useState(applied);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setDraft(applied);
  }

  return {
    draft,
    patch(partial: Partial<T>) {
      setDraft((current) => ({ ...current, ...partial }));
    },
    replace(next: T) {
      setDraft(next);
    },
  };
}

export function submitQueryOnEnter(
  event: { key: string; preventDefault: () => void; nativeEvent: { isComposing?: boolean; keyCode?: number } },
  submit: () => void,
) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  submit();
}
