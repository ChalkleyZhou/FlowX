import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';

type Transport = Pick<ReturnType<typeof nodemailer.createTransport>, 'sendMail'>;

export function signDingTalkRobotUrl(webhookUrl: string, secret?: string, now = Date.now()) {
  if (!secret) {
    return webhookUrl;
  }

  const timestamp = String(now);
  const sign = encodeURIComponent(
    createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'),
  );
  const separator = webhookUrl.includes('?') ? '&' : '?';
  return `${webhookUrl}${separator}timestamp=${timestamp}&sign=${sign}`;
}

export async function sendDingTalkMarkdown(input: {
  webhookUrl: string;
  secret?: string;
  title: string;
  markdown: string;
  fetchImpl?: typeof fetch;
}) {
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(signDingTalkRobotUrl(input.webhookUrl, input.secret), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        title: input.title,
        text: input.markdown,
      },
    }),
  });
  const body = (await response.json()) as { errcode?: number; errmsg?: string };

  if (!response.ok || body.errcode !== 0) {
    throw new Error(`DingTalk robot delivery failed: ${JSON.stringify(body)}`);
  }

  return body;
}

export async function sendEmail(input: {
  smtp: { host: string; port: number; user: string; password: string; from: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  transportFactory?: () => Transport;
}) {
  const transport =
    input.transportFactory?.() ??
    nodemailer.createTransport({
      host: input.smtp.host,
      port: input.smtp.port,
      auth: {
        user: input.smtp.user,
        pass: input.smtp.password,
      },
    });

  return transport.sendMail({
    from: input.smtp.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

