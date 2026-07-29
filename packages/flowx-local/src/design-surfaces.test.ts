import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertDesignSurfacesPresent, loadDesignSurfacesFromDir } from './design-surfaces.js';

describe('loadDesignSurfacesFromDir', () => {
  it('loads surfaces from design/<surfaceId>/*.html', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flowx-design-surfaces-'));
    await mkdir(join(root, 'design', 'Web端'), { recursive: true });
    await mkdir(join(root, 'design', '移动端'), { recursive: true });
    await writeFile(join(root, 'design', 'Web端', '首页.html'), '<!doctype html><html>web</html>');
    await writeFile(join(root, 'design', '移动端', '首页.html'), '<!doctype html><html>mobile</html>');

    const surfaces = await loadDesignSurfacesFromDir(root);
    expect(surfaces.map((s) => s.id).sort()).toEqual(['Web端', '移动端']);
    expect(surfaces.find((s) => s.id === 'Web端')?.pages[0]?.id).toBe('首页');
  });

  it('filters by onlySurfaceId', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flowx-design-surfaces-'));
    await mkdir(join(root, 'design', 'Web端'), { recursive: true });
    await mkdir(join(root, 'design', '移动端'), { recursive: true });
    await writeFile(join(root, 'design', 'Web端', 'a.html'), '<html>a</html>');
    await writeFile(join(root, 'design', '移动端', 'b.html'), '<html>b</html>');

    const surfaces = await loadDesignSurfacesFromDir(root, 'Web端');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.id).toBe('Web端');
  });
});

describe('assertDesignSurfacesPresent', () => {
  it('rejects empty surfaces', () => {
    expect(() => assertDesignSurfacesPresent([])).toThrow(/surfaces/);
  });
});
