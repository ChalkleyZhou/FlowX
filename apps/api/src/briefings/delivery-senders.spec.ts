import { describe, expect, it, vi } from 'vitest';
import { sendDingTalkMarkdown, sendEmail, signDingTalkRobotUrl } from './delivery-senders';

describe('briefing delivery senders', () => {
  it('signs DingTalk robot URLs when a secret is provided', () => {
    const signedUrl = signDingTalkRobotUrl(
      'https://oapi.dingtalk.com/robot/send?access_token=token',
      'secret',
      1717400000000,
    );

    expect(signedUrl).toContain('access_token=token');
    expect(signedUrl).toContain('timestamp=1717400000000');
    expect(signedUrl).toContain('sign=');
  });

  it('sends DingTalk markdown messages and returns provider body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0, errmsg: 'ok' }),
    });

    const result = await sendDingTalkMarkdown({
      webhookUrl: 'https://oapi.dingtalk.com/robot/send',
      title: 'Daily Briefing',
      markdown: '# Hello',
      fetchImpl,
    });

    expect(result).toEqual({ errcode: 0, errmsg: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://oapi.dingtalk.com/robot/send',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            title: 'Daily Briefing',
            text: '# Hello',
          },
        }),
      }),
    );
  });

  it('throws when DingTalk returns a non-zero errcode', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 310000, errmsg: 'bad sign' }),
    });

    await expect(
      sendDingTalkMarkdown({
        webhookUrl: 'https://oapi.dingtalk.com/robot/send',
        title: 'Daily Briefing',
        markdown: '# Hello',
        fetchImpl,
      }),
    ).rejects.toThrow('DingTalk robot delivery failed');
  });

  it('sends email through the provided transport factory', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1' });

    const result = await sendEmail({
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        user: 'user',
        password: 'password',
        from: 'flowx@example.com',
      },
      to: 'team@example.com',
      subject: 'Daily Briefing',
      html: '<h1>Hello</h1>',
      text: '# Hello',
      transportFactory: () => ({ sendMail }),
    });

    expect(result).toEqual({ messageId: 'msg-1' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'flowx@example.com',
      to: 'team@example.com',
      subject: 'Daily Briefing',
      html: '<h1>Hello</h1>',
      text: '# Hello',
    });
  });
});

