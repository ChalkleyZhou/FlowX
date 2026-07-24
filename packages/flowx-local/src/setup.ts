import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SetupTarget = 'cursor' | 'codex' | 'od';

export type SetupOptions = {
  homeDir?: string;
  targets?: string;
  force?: boolean;
};

export type SetupResult = {
  written: string[];
  skipped: string[];
};

const DEFAULT_TARGETS: SetupTarget[] = ['cursor', 'codex', 'od'];
const SKILL_NAME = 'flowx-brainstorm-spec';

export function parseSetupTargets(raw?: string): SetupTarget[] {
  const text = raw?.trim();
  if (!text) {
    return [...DEFAULT_TARGETS];
  }
  const parts = text
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) {
    return [...DEFAULT_TARGETS];
  }
  const allowed: SetupTarget[] = ['cursor', 'codex', 'od'];
  const targets: SetupTarget[] = [];
  for (const part of parts) {
    if (!allowed.includes(part as SetupTarget)) {
      throw new Error(`Unknown setup target: ${part}. Use cursor, codex, and/or od.`);
    }
    if (!targets.includes(part as SetupTarget)) {
      targets.push(part as SetupTarget);
    }
  }
  return targets;
}

export function skillTemplatePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    SKILL_NAME,
    'SKILL.md',
  );
}

export function resolveSkillInstallPaths(
  target: SetupTarget,
  homeDir = homedir(),
): string[] {
  if (target === 'cursor' || target === 'od') {
    return [join(homeDir, '.cursor', 'skills', SKILL_NAME, 'SKILL.md')];
  }
  return [join(homeDir, '.agents', 'skills', SKILL_NAME, 'SKILL.md')];
}

function writeSkill(path: string, content: string, force: boolean): 'written' | 'skipped' {
  if (existsSync(path) && !force) {
    return 'skipped';
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return 'written';
}

export function runSetup(options: SetupOptions = {}): SetupResult {
  const homeDir = options.homeDir ?? homedir();
  const force = options.force === true;
  const targets = parseSetupTargets(options.targets);
  const content = readFileSync(skillTemplatePath(), 'utf8');
  const written: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    for (const path of resolveSkillInstallPaths(target, homeDir)) {
      if (seen.has(path)) {
        continue;
      }
      seen.add(path);
      const outcome = writeSkill(path, content, force);
      if (outcome === 'written') {
        written.push(path);
      } else {
        skipped.push(path);
      }
    }
  }

  return { written, skipped };
}
