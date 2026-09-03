import { accessSync, constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const BIN_NAME = 'flowx-local';

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInPath(pathEnv: string, names: string[]): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function argv1Exists(argv1: string | undefined): string | null {
  if (!argv1) {
    return null;
  }
  try {
    accessSync(argv1, constants.F_OK);
    return resolve(argv1);
  } catch {
    return null;
  }
}

export function resolveFlowxLocalBin(
  input: { pathEnv?: string; argv1?: string; platform?: NodeJS.Platform } = {},
): string {
  const pathEnv = input.pathEnv ?? process.env.PATH ?? '';
  const argv1 = input.argv1 ?? process.argv[1];
  const platform = input.platform ?? process.platform;
  const names =
    platform === 'win32' ? [`${BIN_NAME}.cmd`, `${BIN_NAME}.exe`, BIN_NAME] : [BIN_NAME];

  const fromPath = findInPath(pathEnv, names);
  if (fromPath) {
    return fromPath;
  }

  const fromArgv1 = argv1Exists(argv1);
  if (fromArgv1) {
    return fromArgv1;
  }

  throw new Error(`Could not resolve ${BIN_NAME} executable on PATH or from CLI entry`);
}
