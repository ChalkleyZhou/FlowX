import { homedir } from 'node:os';
import { OpenDesignAdapter } from './adapters/open-design-adapter.js';
import { ensureDeviceIdentity } from './device.js';
import { EdgeClient } from './edge-client.js';
import { Outbox } from './outbox.js';

export type OpenDesignLaunchRequest = { ticket: string; apiBaseUrl: string };

export async function runOpenDesignLaunch(
  request: OpenDesignLaunchRequest,
  options: { homeDir?: string; fetch?: typeof fetch } = {},
) {
  const homeDir = options.homeDir ?? homedir();
  const config = ensureDeviceIdentity({ homeDir });
  const outbox = new Outbox({ homeDir });
  const client = new EdgeClient(outbox, options.fetch);
  const redeemed = await client.redeemOpenDesignLaunch(request.apiBaseUrl, request.ticket);
  return new OpenDesignAdapter(config, client, homeDir).launch(redeemed);
}

export async function submitOpenDesignResult(
  executionSessionId: string,
  options: { homeDir?: string; fetch?: typeof fetch } = {},
) {
  const homeDir = options.homeDir ?? homedir();
  const config = ensureDeviceIdentity({ homeDir });
  const outbox = new Outbox({ homeDir });
  const client = new EdgeClient(outbox, options.fetch);
  return new OpenDesignAdapter(config, client, homeDir).submit(executionSessionId);
}

export async function syncOpenDesignOutbox(
  options: { homeDir?: string; fetch?: typeof fetch } = {},
) {
  const homeDir = options.homeDir ?? homedir();
  const config = ensureDeviceIdentity({ homeDir });
  const outbox = new Outbox({ homeDir });
  const client = new EdgeClient(outbox, options.fetch);
  const adapter = new OpenDesignAdapter(config, client, homeDir);
  return client.flush((credentialRef) => adapter.loadAccessToken(credentialRef));
}
