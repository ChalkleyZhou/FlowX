import { describe, expect, it } from 'vitest';
import { escapeHtml, renderPlanHtml } from './workflow-artifact.render';

describe('renderPlanHtml', () => {
  it('escapes HTML in summary', () => {
    const html = renderPlanHtml({
      summary: '<script>alert(1)</script>',
      implementationPlan: ['step & go'],
      filesToModify: [],
      newFiles: [],
      riskPoints: [],
    }, { workflowRunId: 'run_1', version: 1, status: 'WAITING_HUMAN_CONFIRMATION' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('step &amp; go');
  });

  it('includes stage title and file lists', () => {
    const html = renderPlanHtml({
      summary: 'Login welcome modal',
      implementationPlan: ['Mount modal in App'],
      filesToModify: ['src/App.tsx'],
      newFiles: ['src/WelcomeModal.tsx'],
      riskPoints: ['Rate limit TBD'],
    }, { workflowRunId: 'run_1', version: 1, status: 'WAITING_HUMAN_CONFIRMATION' });
    expect(html).toContain('技术方案');
    expect(html).toContain('src/App.tsx');
    expect(html).toContain('src/WelcomeModal.tsx');
  });
});
