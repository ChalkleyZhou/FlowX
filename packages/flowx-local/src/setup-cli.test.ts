import { describe, expect, it } from 'vitest';
import { parseSetupArgs } from './setup-cli.js';

describe('parseSetupArgs', () => {
  it('defaults flags to false and leaves targets unset', () => {
    expect(parseSetupArgs([])).toEqual({
      noIde: false,
      force: false,
      apiBaseUrl: undefined,
      targets: undefined,
    });
  });

  it('reads --no-ide, --force, --api-base-url, and target list', () => {
    expect(
      parseSetupArgs(['cursor,codex', '--force', '--no-ide', '--api-base-url', 'https://flowx.example/api']),
    ).toEqual({
      noIde: true,
      force: true,
      apiBaseUrl: 'https://flowx.example/api',
      targets: 'cursor,codex',
    });
  });

  it('does not treat the --api-base-url value as a target', () => {
    expect(parseSetupArgs(['--api-base-url', 'https://flowx.example/api', '--no-ide'])).toEqual({
      noIde: true,
      force: false,
      apiBaseUrl: 'https://flowx.example/api',
      targets: undefined,
    });
  });

  it('picks the first non-flag arg that is not the API URL', () => {
    expect(parseSetupArgs(['--api-base-url', 'https://flowx.example/api', 'od'])).toEqual({
      noIde: false,
      force: false,
      apiBaseUrl: 'https://flowx.example/api',
      targets: 'od',
    });
  });

  it('throws when --api-base-url is missing a value', () => {
    expect(() => parseSetupArgs(['--api-base-url'])).toThrow(/Missing value for --api-base-url/);
  });
});
