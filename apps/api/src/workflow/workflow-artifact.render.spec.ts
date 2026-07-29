import { describe, expect, it } from 'vitest';
import { escapeHtml } from './workflow-artifact.render';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('step & go')).toBe('step &amp; go');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("'single'")).toBe('&#39;single&#39;');
  });
});
