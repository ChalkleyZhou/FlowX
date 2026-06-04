import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import type { DeliveryTarget, Project } from '../types';

const TYPE_ORDER = ['EMAIL', 'DINGTALK_APP', 'DINGTALK_ROBOT'] as const;

const TYPE_LABELS: Record<string, string> = {
  EMAIL: '邮件',
  DINGTALK_APP: '钉钉应用通知',
  DINGTALK_ROBOT: '钉钉群机器人',
};

function deliveryTargetDescription(target: DeliveryTarget) {
  if (target.type === 'EMAIL') {
    return target.emailAddress ?? '-';
  }
  if (target.type === 'DINGTALK_APP') {
    return '钉钉工作通知（个人）';
  }
  return target.dingtalkWebhookUrl ?? '-';
}

function deliveryTargetTypeLabel(type: string) {
  return TYPE_LABELS[type] ?? type;
}

function TargetRow({
  target,
  onToggle,
  onDelete,
}: {
  target: DeliveryTarget;
  onToggle: (target: DeliveryTarget) => void;
  onDelete: (target: DeliveryTarget) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{target.name}</div>
        <div className="truncate text-sm text-muted-foreground">{deliveryTargetDescription(target)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={target.isActive ? 'default' : 'outline'}>
          {target.isActive ? '启用' : '停用'}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => onToggle(target)}>
          {target.isActive ? '停用' : '启用'}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(target)}>
          删除
        </Button>
      </div>
    </div>
  );
}

function TargetTypeGroups({
  targets,
  expandedTypes,
  onToggleType,
  onToggleTarget,
  onDeleteTarget,
}: {
  targets: DeliveryTarget[];
  expandedTypes: Set<string>;
  onToggleType: (type: string) => void;
  onToggleTarget: (target: DeliveryTarget) => void;
  onDeleteTarget: (target: DeliveryTarget) => void;
}) {
  const targetsByType = useMemo(() => {
    const groups = new Map<string, DeliveryTarget[]>();
    for (const type of TYPE_ORDER) {
      groups.set(type, []);
    }
    for (const target of targets) {
      const bucket = groups.get(target.type) ?? [];
      bucket.push(target);
      groups.set(target.type, bucket);
    }
    return groups;
  }, [targets]);

  if (targets.length === 0) {
    return <p className="text-sm text-muted-foreground">该项目暂无投递目标。</p>;
  }

  return (
    <div className="space-y-2">
      {TYPE_ORDER.map((type) => {
        const typeTargets = targetsByType.get(type) ?? [];
        if (typeTargets.length === 0) {
          return null;
        }
        const expanded = expandedTypes.has(type);
        return (
          <div key={type} className="rounded-lg border border-border bg-card">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              onClick={() => onToggleType(type)}
              aria-expanded={expanded}
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  expanded && 'rotate-180',
                )}
              />
              <span className="flex-1 text-sm font-medium text-foreground">
                {deliveryTargetTypeLabel(type)}
              </span>
              <span className="text-xs text-muted-foreground">{typeTargets.length} 个</span>
            </button>
            {expanded ? (
              <div className="space-y-2 border-t border-border px-3 py-2.5">
                {typeTargets.map((target) => (
                  <TargetRow
                    key={target.id}
                    target={target}
                    onToggle={onToggleTarget}
                    onDelete={onDeleteTarget}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ProjectTargetSection({
  project,
  targets,
  expanded,
  onToggle,
  expandedTypes,
  onToggleType,
  onToggleTarget,
  onDeleteTarget,
}: {
  project: Project;
  targets: DeliveryTarget[];
  expanded: boolean;
  onToggle: () => void;
  expandedTypes: Set<string>;
  onToggleType: (type: string) => void;
  onToggleTarget: (target: DeliveryTarget) => void;
  onDeleteTarget: (target: DeliveryTarget) => void;
}) {
  const activeCount = targets.filter((item) => item.isActive).length;

  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
        <span className="flex-1 font-semibold text-foreground">{project.name}</span>
        <span className="text-sm text-muted-foreground">
          {targets.length} 个目标 · {activeCount} 个启用
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <TargetTypeGroups
            targets={targets}
            expandedTypes={expandedTypes}
            onToggleType={onToggleType}
            onToggleTarget={onToggleTarget}
            onDeleteTarget={onDeleteTarget}
          />
        </div>
      ) : null}
    </div>
  );
}

export function DeliveryTargetList({
  projects,
  targets,
  onToggleTarget,
  onDeleteTarget,
}: {
  projects: Project[];
  targets: DeliveryTarget[];
  onToggleTarget: (target: DeliveryTarget) => void;
  onDeleteTarget: (target: DeliveryTarget) => void;
}) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedTypesByProject, setExpandedTypesByProject] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );

  const targetsByProjectId = useMemo(() => {
    const groups = new Map<string, DeliveryTarget[]>();
    for (const project of projects) {
      groups.set(project.id, []);
    }
    for (const target of targets) {
      const bucket = groups.get(target.projectId) ?? [];
      bucket.push(target);
      groups.set(target.projectId, bucket);
    }
    return groups;
  }, [projects, targets]);

  function toggleProject(projectId: string) {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function toggleType(projectId: string, type: string) {
    setExpandedTypesByProject((current) => {
      const next = new Map(current);
      const types = new Set(next.get(projectId) ?? TYPE_ORDER);
      if (types.has(type)) {
        types.delete(type);
      } else {
        types.add(type);
      }
      next.set(projectId, types);
      return next;
    });
  }

  function expandedTypesForProject(projectId: string, projectTargets: DeliveryTarget[]) {
    const existing = expandedTypesByProject.get(projectId);
    if (existing) {
      return existing;
    }
    return new Set(TYPE_ORDER.filter((type) => projectTargets.some((item) => item.type === type)));
  }

  if (projects.length === 0) {
    return null;
  }

  const hasAnyTarget = targets.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {projects.map((project) => {
        const projectTargets = targetsByProjectId.get(project.id) ?? [];
        return (
          <ProjectTargetSection
            key={project.id}
            project={project}
            targets={projectTargets}
            expanded={expandedProjectIds.has(project.id)}
            onToggle={() => toggleProject(project.id)}
            expandedTypes={expandedTypesForProject(project.id, projectTargets)}
            onToggleType={(type) => toggleType(project.id, type)}
            onToggleTarget={onToggleTarget}
            onDeleteTarget={onDeleteTarget}
          />
        );
      })}
      {!hasAnyTarget ? (
        <p className="text-sm text-muted-foreground">当前工作区下各项目均未配置投递目标。</p>
      ) : null}
    </div>
  );
}
