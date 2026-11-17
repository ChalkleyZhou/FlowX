import { Button } from './ui/button';

export function ListQueryActions({
  onQuery,
  onClear,
  showClear = false,
}: {
  onQuery: () => void;
  onClear?: () => void;
  showClear?: boolean;
}) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onQuery}>查询</Button>
      {showClear && onClear ? <Button type="button" variant="outline" onClick={onClear}>清除筛选</Button> : null}
    </>
  );
}
