import { Card, Typography } from 'antd';

const { Title, Text } = Typography;

interface SummaryMetricItem {
  key: string;
  label: string;
  value: string | number;
  helpText?: string;
}

interface SummaryMetricsProps {
  items: SummaryMetricItem[];
  className?: string;
}

export function SummaryMetrics({ items, className }: SummaryMetricsProps) {
  return (
    <div className={['page-summary-grid', className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <Card key={item.key} className="summary-card" bordered={false}>
          <Text className="summary-label">{item.label}</Text>
          <Title level={item.helpText ? 4 : 3}>{item.value}</Title>
          {item.helpText ? <Text className="summary-help-text">{item.helpText}</Text> : null}
        </Card>
      ))}
    </div>
  );
}
