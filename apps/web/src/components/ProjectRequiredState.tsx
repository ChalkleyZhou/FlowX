import { Link } from 'react-router-dom';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';

export function ProjectRequiredState() {
  return (
    <EmptyState
      title="先选择一个项目"
      description="看板、需求、工作流和质量数据都跟着当前项目。从左侧切换项目，或先创建一个项目。"
      action={(
        <Button variant="outline" asChild>
          <Link to="/projects">去创建项目</Link>
        </Button>
      )}
    />
  );
}
