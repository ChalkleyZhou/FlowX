import { BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingSourcesService } from './briefing-sources.service';

describe('BriefingSourcesService', () => {
  const repositoryFindFirst = vi.fn();
  const sourceCreate = vi.fn();
  const sourceFindUnique = vi.fn();
  const sourceUpdate = vi.fn();
  const eventCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new BriefingSourcesService({
      repository: { findFirst: repositoryFindFirst },
      briefingSource: {
        create: sourceCreate,
        findUnique: sourceFindUnique,
        update: sourceUpdate,
      },
      briefingEvent: { create: eventCreate, deleteMany: vi.fn() },
    } as never);
  }

  it('rejects source creation when the repository is outside the workspace', async () => {
    repositoryFindFirst.mockResolvedValue(null);

    await expect(
      createService().createSource({
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
        webhookSecret: 'secret',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a source using repository URL inference', async () => {
    repositoryFindFirst.mockResolvedValue({
      id: 'repo-1',
      url: 'https://github.com/rokid/flowx.git',
    });
    sourceCreate.mockResolvedValue({ id: 'source-1' });

    await expect(
      createService().createSource({
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
      }),
    ).resolves.toEqual({ id: 'source-1' });

    expect(sourceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
        provider: 'github',
        externalPath: 'rokid/flowx',
        isActive: true,
        webhookSecret: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      }),
      include: expect.any(Object),
    });
  });

  it('honors an explicit webhook secret when provided', async () => {
    repositoryFindFirst.mockResolvedValue({
      id: 'repo-1',
      url: 'https://github.com/rokid/flowx.git',
    });
    sourceCreate.mockResolvedValue({ id: 'source-1' });

    await createService().createSource({
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      webhookSecret: ' custom-secret ',
    });

    expect(sourceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookSecret: 'custom-secret',
      }),
      include: expect.any(Object),
    });
  });

  it('rejects GitLab webhook requests with invalid tokens', async () => {
    sourceFindUnique.mockResolvedValue({
      id: 'source-1',
      provider: 'gitlab',
      isActive: true,
      webhookSecret: 'secret',
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      externalPath: 'rokid/flowx',
      externalId: null,
    });

    await expect(
      createService().receiveWebhook('source-1', {
        gitlabToken: 'wrong',
        payload: {
          object_kind: 'push',
          project: { id: 42, name: 'flowx', path_with_namespace: 'rokid/flowx' },
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects GitHub webhook requests with invalid signatures', async () => {
    sourceFindUnique.mockResolvedValue({
      id: 'source-1',
      provider: 'github',
      isActive: true,
      webhookSecret: 'secret',
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      externalPath: 'rokid/flowx',
      externalId: null,
    });

    await expect(
      createService().receiveWebhook('source-1', {
        githubEvent: 'push',
        githubSignature: 'sha256=deadbeef',
        rawBody: Buffer.from('{}'),
        payload: {
          ref: 'refs/heads/main',
          repository: { id: 99, full_name: 'rokid/flowx', name: 'flowx' },
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stores first webhook delivery and marks duplicate delivery', async () => {
    sourceFindUnique.mockResolvedValue({
      id: 'source-1',
      provider: 'gitlab',
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      isActive: true,
      webhookSecret: 'secret',
      externalPath: 'rokid/flowx',
      externalId: null,
    });
    eventCreate
      .mockResolvedValueOnce({ id: 'event-1' })
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.2',
        }),
      );

    const payload = {
      object_kind: 'push',
      event_time: '2026-06-03T09:00:00+08:00',
      ref: 'refs/heads/main',
      after: 'abc123',
      commits: [],
      project: { id: 42, name: 'flowx', path_with_namespace: 'rokid/flowx' },
    };

    await expect(
      createService().receiveWebhook('source-1', {
        gitlabToken: 'secret',
        payload,
      }),
    ).resolves.toEqual({ duplicate: false, id: 'event-1' });

    await expect(
      createService().receiveWebhook('source-1', {
        gitlabToken: 'secret',
        payload,
      }),
    ).resolves.toEqual({ duplicate: true });

    expect(sourceUpdate).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: { externalId: '42' },
    });
  });

  it('accepts signed GitHub webhook deliveries', async () => {
    const secret = 'github-secret';
    const rawBody = Buffer.from(
      JSON.stringify({
        ref: 'refs/heads/main',
        repository: { id: 99, full_name: 'rokid/flowx', name: 'flowx' },
        sender: { login: 'alice' },
      }),
    );
    const signature =
      'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

    sourceFindUnique.mockResolvedValue({
      id: 'source-1',
      provider: 'github',
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      isActive: true,
      webhookSecret: secret,
      externalPath: 'rokid/flowx',
      externalId: null,
    });
    eventCreate.mockResolvedValue({ id: 'event-2' });

    await expect(
      createService().receiveWebhook('source-1', {
        githubEvent: 'push',
        githubSignature: signature,
        rawBody,
        payload: JSON.parse(rawBody.toString('utf8')),
      }),
    ).resolves.toEqual({ duplicate: false, id: 'event-2' });
  });

  it('rejects unsupported repository URLs during binding resolution', async () => {
    repositoryFindFirst.mockResolvedValue({
      id: 'repo-1',
      name: 'bad',
      url: 'ftp://example.com/a/b',
    });

    await expect(
      createService().resolveRepositoryBinding('workspace-1', 'repo-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
