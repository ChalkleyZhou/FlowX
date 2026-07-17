import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeReviewSourcesService } from './code-review-sources.service';

describe('CodeReviewSourcesService', () => {
  const repositoryFindFirst = vi.fn();
  const sourceFindMany = vi.fn();
  const sourceUpsert = vi.fn();
  const sourceUpdate = vi.fn();
  const sourceFindUnique = vi.fn();
  const sourceDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new CodeReviewSourcesService({
      repository: { findFirst: repositoryFindFirst },
      codeReviewSource: {
        findMany: sourceFindMany,
        upsert: sourceUpsert,
        update: sourceUpdate,
        findUnique: sourceFindUnique,
        delete: sourceDelete,
      },
    } as never);
  }

  it('lists sources scoped to a workspace when provided', async () => {
    sourceFindMany.mockResolvedValue([{ id: 'cr-1' }]);

    await expect(createService().listSources('workspace-1')).resolves.toEqual([{ id: 'cr-1' }]);

    expect(sourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'workspace-1' },
      }),
    );
  });

  it('lists all sources when no workspace is provided', async () => {
    sourceFindMany.mockResolvedValue([]);

    await createService().listSources();

    expect(sourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: undefined,
      }),
    );
  });

  it('rejects creation when the repository is outside the workspace', async () => {
    repositoryFindFirst.mockResolvedValue(null);

    await expect(
      createService().createSource({
        workspaceId: 'workspace-1',
        repositoryId: 'repo-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(sourceUpsert).not.toHaveBeenCalled();
  });

  it('upserts an active CodeReviewSource for the repository', async () => {
    repositoryFindFirst.mockResolvedValue({ id: 'repo-1', workspaceId: 'workspace-1' });
    sourceUpsert.mockResolvedValue({ id: 'cr-1', repositoryId: 'repo-1', isActive: true });

    await expect(
      createService().createSource({ workspaceId: 'workspace-1', repositoryId: 'repo-1' }),
    ).resolves.toEqual({ id: 'cr-1', repositoryId: 'repo-1', isActive: true });

    expect(sourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repositoryId: 'repo-1' },
        create: expect.objectContaining({
          workspaceId: 'workspace-1',
          repositoryId: 'repo-1',
          isActive: true,
        }),
        update: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it('updates isActive for an existing source', async () => {
    sourceFindUnique.mockResolvedValue({ id: 'cr-1' });
    sourceUpdate.mockResolvedValue({ id: 'cr-1', isActive: false });

    await expect(
      createService().updateSource('cr-1', { isActive: false }),
    ).resolves.toEqual({ id: 'cr-1', isActive: false });

    expect(sourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cr-1' },
        data: { isActive: false },
      }),
    );
  });

  it('throws when updating a missing source', async () => {
    sourceFindUnique.mockResolvedValue(null);

    await expect(
      createService().updateSource('missing', { isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an existing source', async () => {
    sourceFindUnique.mockResolvedValue({ id: 'cr-1' });
    sourceDelete.mockResolvedValue({ id: 'cr-1' });

    await expect(createService().deleteSource('cr-1')).resolves.toEqual({ success: true });

    expect(sourceDelete).toHaveBeenCalledWith({ where: { id: 'cr-1' } });
  });

  it('throws when deleting a missing source', async () => {
    sourceFindUnique.mockResolvedValue(null);

    await expect(createService().deleteSource('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
