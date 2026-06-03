import { randomBytes } from 'node:crypto';

export function generateWebhookSecret() {
  return randomBytes(24).toString('base64url');
}
