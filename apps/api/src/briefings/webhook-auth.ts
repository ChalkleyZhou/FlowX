import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyGithubWebhookSignature(
  secret: string,
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
) {
  if (!secret || !rawBody || !signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const expected =
    'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
