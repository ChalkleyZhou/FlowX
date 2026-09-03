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

function findInPath(pathEnv: string): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, BIN_NAME);
    if (isExecutable(candidate)) {
      return candidate;
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

export function resolveFlowxLocalBin(input: { pathEnv?: string; argv1?: string } = {}): string {
  const pathEnv = input.pathEnv ?? process.env.PATH ?? '';
  const argv1 = input.argv1 ?? process.argv[1];

  const fromPath = findInPath(pathEnv);
  if (fromPath) {
    return fromPath;
  }

  const fromArgv1 = argv1Exists(argv1);
  if (fromArgv1) {
    return fromArgv1;
  }

  throw new Error(`Could not resolve ${BIN_NAME} executable on PATH or from CLI entry`);
}
