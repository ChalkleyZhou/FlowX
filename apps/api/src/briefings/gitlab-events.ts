export type GitlabEventType =
  | 'push'
  | 'tag'
  | 'merge_request'
  | 'issue'
  | 'note'
  | 'pipeline'
  | 'release'
  | 'unsupported';

export interface NormalizedGitlabEvent {
  eventType: GitlabEventType;
  objectKind: string;
  gitlabProjectId: number;
  projectName: string;
  actorName?: string;
  actorUsername?: string;
  action?: string;
  subject: string;
  url?: string;
  occurredAt: string;
  summary: Record<string, string | number | boolean | null>;
}

type GitlabPayload = Record<string, unknown>;
type GitlabObject = Record<string, unknown>;

function asObject(value: unknown): GitlabObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as GitlabObject)
    : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value);
}

function payloadProject(payload: GitlabPayload) {
  return asObject(payload.project);
}

function payloadActor(payload: GitlabPayload) {
  const user = asObject(payload.user);
  return {
    actorName: asString(payload.user_name) || asString(user.name) || undefined,
    actorUsername: asString(payload.user_username) || asString(user.username) || undefined,
  };
}

function payloadOccurredAt(payload: GitlabPayload) {
  const attributes = asObject(payload.object_attributes);
  return (
    asString(payload.event_time) ||
    asString(attributes.updated_at) ||
    asString(attributes.created_at) ||
    new Date().toISOString()
  );
}

function eventTypeFromObjectKind(objectKind: string): GitlabEventType {
  if (objectKind === 'push') {
    return 'push';
  }
  if (objectKind === 'tag_push') {
    return 'tag';
  }
  if (objectKind === 'merge_request') {
    return 'merge_request';
  }
  if (objectKind === 'issue') {
    return 'issue';
  }
  if (objectKind === 'note') {
    return 'note';
  }
  if (objectKind === 'pipeline') {
    return 'pipeline';
  }
  if (objectKind === 'release') {
    return 'release';
  }
  return 'unsupported';
}

export function normalizeGitlabPayload(payload: GitlabPayload): NormalizedGitlabEvent {
  const objectKind = asString(payload.object_kind) || asString(payload.objectKind) || 'unsupported';
  const eventType = eventTypeFromObjectKind(objectKind);
  const project = payloadProject(payload);
  const attributes = asObject(payload.object_attributes);
  const base = {
    eventType,
    objectKind,
    gitlabProjectId: asNumber(project.id),
    projectName: asString(project.name),
    ...payloadActor(payload),
    occurredAt: new Date(payloadOccurredAt(payload)).toISOString(),
  };

  if (eventType === 'push' || eventType === 'tag') {
    const ref = asString(payload.ref).replace(/^refs\/(heads|tags)\//, '');
    return {
      ...base,
      action: eventType === 'tag' ? 'tag_push' : 'push',
      subject: ref,
      summary: {
        ref,
        after: asString(payload.after) || null,
        commitCount: Array.isArray(payload.commits) ? payload.commits.length : 0,
      },
    };
  }

  if (eventType === 'pipeline') {
    return {
      ...base,
      action: asString(attributes.status) || 'unknown',
      subject: asString(attributes.ref),
      url: asString(attributes.url) || undefined,
      summary: {
        id: typeof attributes.id === 'number' ? attributes.id : null,
        ref: asString(attributes.ref) || null,
        status: asString(attributes.status) || null,
      },
    };
  }

  return {
    ...base,
    action: asString(attributes.action) || undefined,
    subject:
      asString(attributes.title) ||
      asString(attributes.note) ||
      asString(attributes.name) ||
      objectKind,
    url: asString(attributes.url) || undefined,
    summary: {
      iid: typeof attributes.iid === 'number' ? attributes.iid : null,
      id: typeof attributes.id === 'number' ? attributes.id : null,
      state: asString(attributes.state) || null,
      action: asString(attributes.action) || null,
    },
  };
}

export function buildDedupeKey(event: NormalizedGitlabEvent) {
  const objectId = event.summary.id ?? event.summary.iid ?? event.summary.after ?? event.subject;
  return [event.eventType, event.gitlabProjectId, event.subject, objectId, event.occurredAt].join(
    ':',
  );
}

