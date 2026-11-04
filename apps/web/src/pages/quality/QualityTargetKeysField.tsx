export const QUALITY_TARGET_OPTIONS = [
  { key: 'web', name: 'Web' },
  { key: 'api', name: 'API' },
  { key: 'ios', name: 'iOS' },
  { key: 'android', name: 'Android' },
];

export function QualityTargetKeysField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">用例适用端</legend>
      <div className="flex flex-wrap gap-4">
        {QUALITY_TARGET_OPTIONS.map((target) => (
          <label key={target.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`适用端 ${target.name}`}
              checked={value.includes(target.key)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked ? [...value, target.key] : value.filter((key) => key !== target.key),
                )
              }
            />
            {target.name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        不选表示尚未确认，创建本地轮次时须明确指定；不会自动作为全部端。
      </p>
    </fieldset>
  );
}
