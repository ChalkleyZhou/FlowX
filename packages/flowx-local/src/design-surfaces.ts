import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesignSurfacePayload } from '@flowx-ai/protocol';

/**
 * 从会话目录 `design/<surfaceId>/*.html` 扫描多端设计稿。
 * surfaceId = 目录名原文；pageId = 去掉 .html 的文件名。
 */
export async function loadDesignSurfacesFromDir(
  sessionDir: string,
  onlySurfaceId?: string,
): Promise<DesignSurfacePayload[]> {
  const designRoot = join(sessionDir, 'design');
  let entries;
  try {
    entries = await readdir(designRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const surfaces: DesignSurfacePayload[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (onlySurfaceId && ent.name !== onlySurfaceId) continue;
    const dir = join(designRoot, ent.name);
    const files = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.html'));
    const pages: DesignSurfacePayload['pages'] = [];
    for (const file of files.sort()) {
      const id = file.replace(/\.html$/i, '');
      if (!id) continue;
      const html = await readFile(join(dir, file), 'utf8');
      if (!html.trim()) continue;
      pages.push({ id, title: id, html });
    }
    if (pages.length > 0) {
      surfaces.push({ id: ent.name, pages });
    }
  }
  return surfaces;
}

export function assertDesignSurfacesPresent(surfaces: DesignSurfacePayload[] | undefined): void {
  if (!surfaces || surfaces.length === 0) {
    throw new Error(
      'OpenDesign design output requires non-empty surfaces[{ id, pages[{ id, html }] }].',
    );
  }
  for (const surface of surfaces) {
    if (!surface.id?.trim()) {
      throw new Error('OpenDesign surface id must be a non-empty string.');
    }
    if (!surface.pages?.length) {
      throw new Error(`OpenDesign surface "${surface.id}" requires at least one page.`);
    }
    for (const page of surface.pages) {
      if (!page.id?.trim() || !page.html?.trim()) {
        throw new Error(
          `OpenDesign surface "${surface.id}" has a page missing id or html.`,
        );
      }
    }
  }
}
