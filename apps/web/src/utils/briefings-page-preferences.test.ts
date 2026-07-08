// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  readBriefingsPagePreferences,
  writeBriefingsPagePreferences,
} from './briefings-page-preferences';

describe('briefings-page-preferences', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns empty preferences when nothing is stored', () => {
    expect(readBriefingsPagePreferences()).toEqual({});
  });

  it('persists and merges project, view, and period preferences', () => {
    writeBriefingsPagePreferences({ projectId: 'project-1', activeView: 'code-reviews' });
    writeBriefingsPagePreferences({ period: 'WEEKLY' });

    expect(readBriefingsPagePreferences()).toEqual({
      projectId: 'project-1',
      activeView: 'code-reviews',
      period: 'WEEKLY',
    });
  });

  it('ignores invalid stored values', () => {
    window.localStorage.setItem(
      'flowx-briefings-page-preferences',
      JSON.stringify({
        projectId: '',
        activeView: 'invalid',
        period: 'MONTHLY',
      }),
    );

    expect(readBriefingsPagePreferences()).toEqual({});
  });
});
