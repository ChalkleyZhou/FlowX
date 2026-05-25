import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { applyDemoNavAgentPatches } from './apply-demo-nav-agent-patches';

describe('applyDemoNavAgentPatches', () => {
  it('inserts after anchor when unique', async () => {
    const dir = join(process.cwd(), '.tmp-nav-agent-test-' + Date.now());
    await mkdir(dir, { recursive: true });
    const rel = 'shell.tsx';
    const abs = join(dir, rel);
    await writeFile(abs, `const items = [\n  { a: 1 },\n];\n`, 'utf8');

    const { written, warnings } = await applyDemoNavAgentPatches(dir, [
      {
        relativePath: rel,
        insertAfter: 'const items = [',
        insertText: '\n  { key: "/x", label: "Y" },',
      },
    ]);

    expect(warnings).toEqual([]);
    expect(written).toEqual([rel]);
    expect(await readFile(abs, 'utf8')).toContain('{ key: "/x", label: "Y" }');
    await rm(dir, { recursive: true, force: true });
  });

  it('applies same-file patches bottom-up when sorted', async () => {
    const dir = join(process.cwd(), '.tmp-nav-agent-test2-' + Date.now());
    await mkdir(dir, { recursive: true });
    const rel = 'layout.tsx';
    const abs = join(dir, rel);
    await writeFile(
      abs,
      `const routeLabel = {\n  '/': 'home',\n};\nconst items = [\n];\n`,
      'utf8',
    );

    const { written } = await applyDemoNavAgentPatches(dir, [
      {
        relativePath: rel,
        insertAfter: "const items = [",
        insertText: '\n  { k: 1 },',
      },
      {
        relativePath: rel,
        insertAfter: 'const routeLabel = {',
        insertText: "\n  '/demo': 'Demo',",
      },
    ]);

    expect(written).toEqual([rel]);
    const text = await readFile(abs, 'utf8');
    expect(text).toContain("'/demo': 'Demo'");
    expect(text).toContain('{ k: 1 }');
    await rm(dir, { recursive: true, force: true });
  });
});
