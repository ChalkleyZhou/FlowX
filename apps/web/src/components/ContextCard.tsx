import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { SectionHeader } from './SectionHeader';

const { Text } = Typography;

interface ContextMetricItem {
  key: string;
  label: string;
  value: ReactNode;
}

interface ContextCardProps {
  eyebrow: string;
  title: string;
  metrics?: ContextMetricItem[];
  children?: ReactNode;
  loading?: boolean;
}

export function ContextCard({ eyebrow, title, metrics, children, loading }: ContextCardProps) {
  return (
    <Card className="panel workflow-side-panel" bordered={false} loading={loading}>
      <SectionHeader eyebrow={eyebrow} title={title} />
      {metrics?.length ? (
        <div className="workflow-side-metrics">
          {metrics.map((item) => (
            <div key={item.key} className="workflow-side-metric">
              <Text className="summary-label">{item.label}</Text>
              <Text strong>{item.value}</Text>
            </div>
          ))}
        </div>
      ) : null}
      {children}
    </Card>
  );
}
