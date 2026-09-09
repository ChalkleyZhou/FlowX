import type {
  BrainstormCompletionReport,
  DesignCompletionReport,
  OpenDesignBrainstormHandoff,
  OpenDesignHandoff,
} from '@flowx-ai/protocol';
import { readFile } from 'node:fs/promises';
import { Outbox, type OutboxItem } from './outbox.js';

export type RedeemedOpenDesignLaunch = {
  kind: 'opendesign' | 'opendesign-brainstorm';
  stage?: 'brainstorm' | 'design';
  apiBaseUrl: string;
  handoff: OpenDesignHandoff | OpenDesignBrainstormHandoff;
  accessToken: string;
  accessTokenExpiresAt: string;
};

export class EdgeClient {
  constructor(
    private readonly outbox: Outbox,
    private readonly send: typeof fetch = fetch,
  ) {}

  async redeemOpenDesignLaunch(apiBaseUrl: string, ticket: string) {
    const normalizedApiBaseUrl = normalizeBase(apiBaseUrl);
    const response = await this.send(
      `${normalizedApiBaseUrl}/edge/design-launch/redeem`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket }),
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to redeem OpenDesign launch ticket (${response.status}).`);
    }
    const redeemed = (await response.json()) as RedeemedOpenDesignLaunch;
    return {
      ...redeemed,
      // API 服务端可能运行在容器或远程主机，不能把它看到的 loopback 地址交给设计师本机。
      apiBaseUrl: normalizedApiBaseUrl,
    };
  }

  async submitDesign(input: {
    apiBaseUrl: string;
    accessToken: string;
    executionSessionId: string;
    report: DesignCompletionReport;
  }) {
    const item = {
      kind: 'design-completion' as const,
      credentialRef: input.executionSessionId,
      apiBaseUrl: normalizeBase(input.apiBaseUrl),
      path: `/execution-sessions/${input.executionSessionId}/design/complete`,
      method: 'POST' as const,
      body: input.report,
    };
    try {
      await this.sendItem(item, input.accessToken);
      return { queued: false };
    } catch (error) {
      await this.outbox.enqueue(item);
      return {
        queued: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async submitBrainstorm(input: {
    apiBaseUrl: string;
    accessToken: string;
    executionSessionId: string;
    report: BrainstormCompletionReport;
  }) {
    const item = {
      kind: 'brainstorm-completion' as const,
      credentialRef: input.executionSessionId,
      apiBaseUrl: normalizeBase(input.apiBaseUrl),
      path: `/execution-sessions/${input.executionSessionId}/brainstorm/complete`,
      method: 'POST' as const,
      body: input.report,
    };
    try {
      await this.sendItem(item, input.accessToken);
      return { queued: false };
    } catch (error) {
      await this.outbox.enqueue(item);
      return {
        queued: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  flush(resolveToken: (credentialRef: string) => Promise<string>) {
    return this.outbox.flush(async (item) => {
      const token = await resolveToken(item.credentialRef);
      await this.sendItem(item, token);
    });
  }

  private async sendItem(
    item: Pick<OutboxItem, 'apiBaseUrl' | 'path' | 'method' | 'body'>,
    accessToken: string,
  ) {
    if (item.method === 'ARTIFACT_UPLOAD') {
      const uploadItem = item as OutboxItem;
      if (!uploadItem.filePath || !uploadItem.uploadPath) {
        throw new Error('Queued artifact upload is missing its stable file or upload path.');
      }
      const createResponse = await this.send(`${normalizeBase(item.apiBaseUrl)}${item.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(item.body),
      });
      if (!createResponse.ok) {
        throw new Error((await createResponse.text()) || `FlowX API returned ${createResponse.status}.`);
      }
      const content = await readFile(uploadItem.filePath);
      const uploadBody = new Uint8Array(content.byteLength);
      uploadBody.set(content);
      const uploadResponse = await this.send(
        `${normalizeBase(item.apiBaseUrl)}${uploadItem.uploadPath}`,
        {
          method: 'PUT',
          headers: {
            'content-type': uploadItem.contentType || 'application/octet-stream',
            authorization: `Bearer ${accessToken}`,
          },
          body: uploadBody,
        },
      );
      if (!uploadResponse.ok) {
        throw new Error((await uploadResponse.text()) || `FlowX API returned ${uploadResponse.status}.`);
      }
      return;
    }
    const response = await this.send(`${normalizeBase(item.apiBaseUrl)}${item.path}`, {
      method: item.method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(item.body),
    });
    if (!response.ok) {
      throw new Error((await response.text()) || `FlowX API returned ${response.status}.`);
    }
  }
}

function normalizeBase(value: string) {
  return value.trim().replace(/\/+$/, '');
}
