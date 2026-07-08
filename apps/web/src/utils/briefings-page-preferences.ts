import type { BriefingPeriod } from '../types';

export type BriefingsView = 'briefings' | 'code-reviews';

export type BriefingsPagePreferences = {
  projectId?: string;
  activeView?: BriefingsView;
  period?: BriefingPeriod;
};

const STORAGE_KEY = 'flowx-briefings-page-preferences';

function isBriefingsView(value: unknown): value is BriefingsView {
  return value === 'briefings' || value === 'code-reviews';
}

function isBriefingPeriod(value: unknown): value is BriefingPeriod {
  return value === 'DAILY' || value === 'WEEKLY';
}

export function readBriefingsPagePreferences(): BriefingsPagePreferences {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const preferences: BriefingsPagePreferences = {};
    if (typeof parsed.projectId === 'string' && parsed.projectId) {
      preferences.projectId = parsed.projectId;
    }
    if (isBriefingsView(parsed.activeView)) {
      preferences.activeView = parsed.activeView;
    }
    if (isBriefingPeriod(parsed.period)) {
      preferences.period = parsed.period;
    }
    return preferences;
  } catch {
    return {};
  }
}

export function writeBriefingsPagePreferences(patch: BriefingsPagePreferences) {
  if (typeof window === 'undefined') {
    return;
  }
  const current = readBriefingsPagePreferences();
  const next: BriefingsPagePreferences = { ...current, ...patch };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
