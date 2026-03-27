import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text, Paragraph } = Typography;

interface DetailBannerProps {
  eyebrow: string;
  title: string;
  description: string;
  tags?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
}

export function DetailBanner({ eyebrow, title, description, tags, actions, loading }: DetailBannerProps) {
  return (
    <Card className="panel workflow-banner" bordered={false} loading={loading}>
      <div className="workflow-banner-copy">
        <Text className="eyebrow">{eyebrow}</Text>
        <Title level={3}>{title}</Title>
        <Paragraph>{description}</Paragraph>
        {tags ? <div className="workspace-meta-row">{tags}</div> : null}
      </div>
      {actions ? <div className="workflow-banner-side">{actions}</div> : null}
    </Card>
  );
}
