import type { ReactNode } from 'react';

interface RecordListItemProps {
  className?: string;
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
}

export function RecordListItem({ className, title, badges, description, details, actions }: RecordListItemProps) {
  return (
    <div className={['record-list-item', className].filter(Boolean).join(' ')}>
      <div className="record-list-main">
        <div className="list-item-head">
          <div className="record-list-title">{title}</div>
        </div>
        {badges ? <div className="workspace-meta-row">{badges}</div> : null}
        {description ? <div className="record-list-description">{description}</div> : null}
        {details ? <div className="record-list-details">{details}</div> : null}
      </div>
      {actions ? <div className="inline-action-group">{actions}</div> : null}
    </div>
  );
}
