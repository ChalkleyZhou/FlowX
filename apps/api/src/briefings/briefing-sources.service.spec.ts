import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingSourcesService } from './briefing-sources.service';

describe('BriefingSourcesService', () => {
  const repositoryFindFirst = vi.fn();
  const sourceCreate = vi.fn();
  const sourceFindUnique = vi.fn();
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
      },
      gitlabEvent: { create: eventCreate },
    } as never);
  }

  it('rejects source creation when the repository is outside the workspace', async () => {
    repositoryFindFirst.mockResolvedValue(null);

    await expect(
      createService().createSource({
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
        gitlabProjectId: 42,
        pathWithNamespace: 'rokid/flowx',
        webhookSecret: 'secret',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a source for a repository in the workspace', async () => {
    repositoryFindFirst.mockResolvedValue({ id: 'repo-1' });
    sourceCreate.mockResolvedValue({ id: 'source-1' });

    await expect(
      createService().createSource({
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
        gitlabProjectId: 42,
        pathWithNamespace: ' rokid/flowx ',
        webhookSecret: ' secret ',
      }),
    ).resolves.toEqual({ id: 'source-1' });

    expect(sourceCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
        provider: 'gitlab',
        gitlabProjectId: 42,
        pathWithNamespace: 'rokid/flowx',
        webhookSecret: 'secret',
        isActive: true,
      },
      include: expect.any(Object),
    });
  });

  it('rejects webhook requests with invalid tokens', async () => {
    sourceFindUnique.mockResolvedValue({
      id: 'source-1',
      isActive: true,
      webhookSecret: 'secret',
    });

    await expect(
      createService().receiveGitlabWebhook('source-1', 'wrong', {
        object_kind: 'push',
        project: { id: 42, name: 'flowx' },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stores first webhook delivery and marks duplicate delivery', async () => {
    sourceFindUnique.mockResolvedValue({
      id: 'source-1',
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
      isActive: true,
      webhookSecret: 'secret',
    });
    eventCreate
      .mockResolvedValueOnce({ id: 'event-1' })
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }));

    await expect(
      createService().receiveGitlabWebhook('source-1', 'secret', {
        object_kind: 'push',
        event_time: '2026-06-03T09:00:00+08:00',
        ref: 'refs/heads/main',
        after: 'abc123',
        commits: [],
        project: { id: 42, name: 'flowx' },
      }),
    ).resolves.toEqual({ duplicate: false, id: 'event-1' });

    await expect(
      createService().receiveGitlabWebhook('source-1', 'secret', {
        object_kind: 'push',
        event_time: '2026-06-03T09:00:00+08:00',
        ref: 'refs/heads/main',
        after: 'abc123',
        commits: [],
        project: { id: 42, name: 'flowx' },
      }),
    ).resolves.toEqual({ duplicate: true });
  });
});

