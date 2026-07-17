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

  it('persists and merges project and period preferences', () => {
    writeBriefingsPagePreferences({ projectId: 'project-1' });
    writeBriefingsPagePreferences({ period: 'WEEKLY' });

    expect(readBriefingsPagePreferences()).toEqual({
      projectId: 'project-1',
      period: 'WEEKLY',
    });
  });

  it('ignores invalid stored values', () => {
    window.localStorage.setItem(
      'flowx-briefings-page-preferences',
      JSON.stringify({
        projectId: '',
        period: 'MONTHLY',
      }),
    );

    expect(readBriefingsPagePreferences()).toEqual({});
  });

  it('does not persist a code-reviews view (removed concept)', () => {
    window.localStorage.setItem(
      'flowx-briefings-page-preferences',
      JSON.stringify({
        projectId: 'project-1',
        activeView: 'code-reviews',
      }),
    );

    expect(readBriefingsPagePreferences()).toEqual({ projectId: 'project-1' });
  });
});
