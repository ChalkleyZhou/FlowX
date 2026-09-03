export type ParsedSetupArgs = {
  noIde: boolean;
  force: boolean;
  apiBaseUrl?: string;
  targets?: string;
};

function readFlagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

export function parseSetupArgs(args: string[]): ParsedSetupArgs {
  const noIde = args.includes('--no-ide');
  const force = args.includes('--force');
  const apiBaseUrl = readFlagValue(args, '--api-base-url');
  const targets = args.find((arg) => !arg.startsWith('--') && arg !== apiBaseUrl);
  return { noIde, force, apiBaseUrl, targets };
}
