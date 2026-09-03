import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeApiBaseUrl, resolveApiBaseUrl } from './api-base-url.js';
import { loadConfig, saveConfig, getConfigPath } from './config.js';
import { resolveFlowxLocalBin } from './flowx-bin.js';
import { promptApiBaseUrl as defaultPromptApiBaseUrl } from './login.js';
import { upsertUserMcp } from './user-mcp.js';
import { installUserService } from './user-service.js';

export type SetupTarget = 'cursor' | 'codex' | 'od';

export type SetupOptions = {
  homeDir?: string;
  targets?: string;
  force?: boolean;
  noIde?: boolean;
  apiBaseUrl?: string;
  envApiBaseUrl?: string;
  flowxBin?: string;
  promptApiBaseUrl?: () => Promise<string>;
  installService?: typeof installUserService;
  resolveBin?: typeof resolveFlowxLocalBin;
};

export type SetupResult = {
  written: string[];
  skipped: string[];
};

export const SETUP_SKILL_NAMES = ['flowx-product-prd', 'flowx-intake-requirement'] as const;
export type SetupSkillName = (typeof SETUP_SKILL_NAMES)[number];

const DEFAULT_TARGETS: SetupTarget[] = ['cursor', 'codex', 'od'];

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

export function skillTemplatePath(skillName: SetupSkillName): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    skillName,
    'SKILL.md',
  );
}

export function resolveSkillInstallPaths(
  target: SetupTarget,
  homeDir = homedir(),
  skillName: SetupSkillName = 'flowx-product-prd',
): string[] {
  if (target === 'cursor') {
    return [join(homeDir, '.cursor', 'skills', skillName, 'SKILL.md')];
  }
  return [join(homeDir, '.agents', 'skills', skillName, 'SKILL.md')];
}

function writeSkill(path: string, content: string, force: boolean): 'written' | 'skipped' {
  if (existsSync(path) && !force) {
    return 'skipped';
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return 'written';
}

export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const homeDir = options.homeDir ?? homedir();
  const configOptions = { homeDir };
  const resolved = resolveApiBaseUrl({
    flag: options.apiBaseUrl,
    env: options.envApiBaseUrl ?? process.env.FLOWX_API_BASE_URL,
    config: loadConfig(configOptions).apiBaseUrl,
  });

  let apiBaseUrl: string;
  if (resolved.source === 'missing') {
    // 交互确认的地址视为已确认，即使是 loopback 占位值
    apiBaseUrl = normalizeApiBaseUrl(
      await (options.promptApiBaseUrl ?? defaultPromptApiBaseUrl)(),
    );
    if (!apiBaseUrl) {
      throw new Error(
        'apiBaseUrl is required. Pass --api-base-url, set FLOWX_API_BASE_URL, or enter an API URL when prompted.',
      );
    }
  } else {
    apiBaseUrl = resolved.url;
  }

  saveConfig({ ...loadConfig(configOptions), apiBaseUrl }, configOptions);

  const bin = options.flowxBin ?? (options.resolveBin ?? resolveFlowxLocalBin)();
  const installResult = await (options.installService ?? installUserService)({
    homeDir,
    flowxBin: bin,
  });

  const written: string[] = [];
  const skipped: string[] = [];
  if (options.noIde) {
    written.push(getConfigPath(configOptions));
    if ('plistPath' in installResult) {
      written.push(installResult.plistPath);
    } else if ('unitPath' in installResult) {
      written.push(installResult.unitPath);
    } else if ('taskXmlPath' in installResult) {
      written.push(installResult.taskXmlPath);
    }
    return { written, skipped };
  }

  const force = options.force === true;
  const targets = parseSetupTargets(options.targets);
  const seen = new Set<string>();

  for (const skillName of SETUP_SKILL_NAMES) {
    const content = readFileSync(skillTemplatePath(skillName), 'utf8');
    for (const target of targets) {
      for (const path of resolveSkillInstallPaths(target, homeDir, skillName)) {
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
  }

  upsertUserMcp({
    homeDir,
    targets: targets.filter((target): target is 'cursor' | 'codex' =>
      target === 'cursor' || target === 'codex',
    ),
    flowxBin: bin,
  });

  return { written, skipped };
}
