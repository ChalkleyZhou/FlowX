import { describe, expect, it, vi } from 'vitest';
import { BriefingsController } from './briefings.controller';

describe('BriefingsController', () => {
  it('passes the authenticated session when manually generating a briefing', () => {
    const generateProjectBriefing = vi.fn().mockReturnValue({ id: 'briefing-1' });
    const controller = new BriefingsController({
      generateProjectBriefing,
    } as never);
    const dto = { period: 'WEEKLY' as const, date: '2026-06-17', regenerate: true };
    const authSession = {
      user: { id: 'user-1', displayName: '张三' },
      organization: { id: 'org-1', name: '研发组织' },
    };

    expect(controller.generateProjectBriefing('project-1', dto, { authSession })).toEqual({
      id: 'briefing-1',
    });

    expect(generateProjectBriefing).toHaveBeenCalledWith('project-1', dto, authSession);
  });
});
