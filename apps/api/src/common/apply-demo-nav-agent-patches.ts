import { readFile, writeFile } from 'fs/promises';
import { join, normalize, resolve } from 'path';

export type DemoNavAgentPatch = {
  relativePath: string;
  insertAfter: string;
  insertText: string;
};

function isUnderRepo(repoRoot: string, absPath: string): boolean {
  const root = resolve(repoRoot);
  const file = resolve(absPath);
  return file === root || file.startsWith(root + '/') || file.startsWith(root + '\\');
}

/** Applies agent patches: each insertAfter must occur exactly once in the current file content. */
export async function applyDemoNavAgentPatches(
  repoRoot: string,
  patches: DemoNavAgentPatch[],
): Promise<{ written: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const written = new Set<string>();

  const byPath = new Map<string, DemoNavAgentPatch[]>();
  for (const p of patches) {
    const rel = normalize(p.relativePath.replace(/\\/g, '/')).replace(/^\.\//, '');
    if (rel.includes('..') || rel.startsWith('/')) {
      warnings.push(`FlowX demo nav agent: skipped unsafe path "${p.relativePath}"`);
      continue;
    }
    const list = byPath.get(rel) ?? [];
    list.push({ ...p, relativePath: rel });
    byPath.set(rel, list);
  }

  for (const [rel, group] of byPath) {
    const abs = join(repoRoot, rel);
    if (!isUnderRepo(repoRoot, abs)) {
      warnings.push(`FlowX demo nav agent: path escapes repo — skipped ${rel}`);
      continue;
    }

    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      warnings.push(`FlowX demo nav agent: could not read ${rel}`);
      continue;
    }

    const positioned = group
      .map((p) => {
        const pos = content.indexOf(p.insertAfter);
        return { ...p, pos };
      })
      .filter((p) => {
        if (p.pos < 0) {
          warnings.push(
            `FlowX demo nav agent: anchor not found in ${rel} (starts with: ${p.insertAfter.slice(0, 40)}…)`,
          );
          return false;
        }
        const occ = content.split(p.insertAfter).length - 1;
        if (occ !== 1) {
          warnings.push(`FlowX demo nav agent: anchor must appear once in ${rel}, got ${occ}`);
          return false;
        }
        return true;
      })
      .sort((a, b) => b.pos - a.pos);

    let next = content;
    for (const p of positioned) {
      const idx = next.indexOf(p.insertAfter);
      if (idx < 0) {
        warnings.push(`FlowX demo nav agent: anchor disappeared during apply ${rel}`);
        break;
      }
      const end = idx + p.insertAfter.length;
      next = next.slice(0, end) + p.insertText + next.slice(end);
    }

    if (next !== content) {
      await writeFile(abs, next, 'utf8');
      written.add(rel);
    }
  }

  return { written: Array.from(written), warnings };
}
