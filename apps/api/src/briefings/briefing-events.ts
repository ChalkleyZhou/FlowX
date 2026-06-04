export type BriefingEventType =
  | 'push'
  | 'tag'
  | 'merge_request'
  | 'issue'
  | 'note'
  | 'pipeline'
  | 'release'
  | 'unsupported';

export type BriefingProvider = 'github' | 'gitlab';

export interface NormalizedBriefingCommit {
  id: string;
  message: string;
  author?: string;
}

export interface NormalizedBriefingEvent {
  provider: BriefingProvider;
  externalPath: string;
  externalId: string;
  eventType: BriefingEventType;
  objectKind: string;
  projectName: string;
  actorName?: string;
  actorUsername?: string;
  action?: string;
  subject: string;
  url?: string;
  occurredAt: string;
  commits?: NormalizedBriefingCommit[];
  summary: Record<string, string | number | boolean | null>;
}

export function buildDedupeKey(event: NormalizedBriefingEvent) {
  const objectId =
    event.summary.id ?? event.summary.iid ?? event.summary.after ?? event.summary.number ?? event.subject;
  return [
    event.provider,
    event.externalPath,
    event.eventType,
    event.subject,
    objectId,
    event.occurredAt,
  ].join(':');
}
