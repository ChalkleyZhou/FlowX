import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalIntegrationsService } from './external-integrations.service';

describe('ExternalIntegrationsService', () => {
  const findFirst = vi.fn();
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const mappingFindMany = vi.fn();
  const mappingUpsert = vi.fn();
  const mappingDeleteMany = vi.fn();
  const recipientDeleteMany = vi.fn();
  const organizationMemberFindMany = vi.fn();
  const listProjectMembers = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mappingFindMany.mockResolvedValue([]);
    mappingDeleteMany.mockResolvedValue({ count: 1 });
    recipientDeleteMany.mockResolvedValue({ count: 2 });
  });

  function createService(secret = 'yunxiao-secret', personalAccessToken?: string) {
    return new ExternalIntegrationsService(
      {
        externalIntegration: { findFirst, create, update },
        userOrganization: { findUnique, findMany: organizationMemberFindMany },
        yunxiaoMemberMapping: {
          findMany: mappingFindMany,
          upsert: mappingUpsert,
          deleteMany: mappingDeleteMany,
        },
        yunxiaoWebhookRecipient: { deleteMany: recipientDeleteMany },
      } as never,
      {
        get: (key: string) => key === 'YUNXIAO_WEBHOOK_SECRET'
          ? secret
          : key === 'YUNXIAO_PERSONAL_ACCESS_TOKEN' ? personalAccessToken : undefined,
      } as never,
      { listProjectMembers } as never,
    );
  }

  it('没有数据库记录时沿用已配置 Secret 的兼容默认状态', async () => {
    findFirst.mockResolvedValue(null);

    await expect(createService().getYunxiaoStatus('org-1')).resolves.toEqual({
      provider: 'YUNXIAO',
      enabled: true,
      configured: true,
      openApiConfigured: false,
      webhookPath: '/api/yunxiao-webhooks',
      yunxiaoOrganizationIdentifier: null,
    });
  });

  it('管理员可以持久化停用状态', async () => {
    findUnique.mockResolvedValue({ role: 'admin' });
    findFirst.mockResolvedValue({ id: 'integration-1', enabled: true });
    update.mockResolvedValue({ enabled: false });

    await expect(createService().updateYunxiaoStatus('org-1', 'user-1', false)).resolves.toMatchObject({
      provider: 'YUNXIAO',
      enabled: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'integration-1' },
      data: { enabled: false },
    });
  });

  it('子管理员可以持久化停用状态', async () => {
    findUnique.mockResolvedValue({ role: 'sub_admin' });
    findFirst.mockResolvedValue({ id: 'integration-1', enabled: true });
    update.mockResolvedValue({ enabled: false });

    await expect(createService().updateYunxiaoStatus('org-1', 'user-1', false)).resolves.toMatchObject({
      provider: 'YUNXIAO',
      enabled: false,
    });
  });

  it('非管理员不能切换云效开关', async () => {
    findUnique.mockResolvedValue({ role: 'member' });

    await expect(createService().updateYunxiaoStatus('org-1', 'user-1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('没有配置 Secret 时报告未配置', async () => {
    findFirst.mockResolvedValue({ enabled: false });

    await expect(createService('').getYunxiaoStatus('org-1')).resolves.toMatchObject({
      enabled: false,
      configured: false,
    });
  });

  it('只有个人 Token 时报告云效 API 已配置', async () => {
    findFirst.mockResolvedValue({ enabled: false });

    await expect(createService('yunxiao-secret', 'personal-token').getYunxiaoStatus('org-1'))
      .resolves.toMatchObject({ openApiConfigured: true });
  });

  it('没有配置 Secret 时不能启用云效', async () => {
    await expect(createService('').updateYunxiaoStatus('org-1', 'user-1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('管理员可以保存云效组织绑定', async () => {
    findUnique.mockResolvedValue({ role: 'admin' });
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({
      enabled: true,
      yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
    });

    await expect(
      createService().updateYunxiaoStatus(
        'org-1',
        'user-1',
        true,
        { yunxiaoOrganizationIdentifier: 'yunxiao-org-1' },
      ),
    ).resolves.toMatchObject({
      enabled: true,
      yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        provider: 'YUNXIAO',
        enabled: true,
        yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
      },
    });
  });

  it('云效组织已被其他 FlowX 组织绑定时返回冲突', async () => {
    findUnique.mockResolvedValue({ role: 'admin' });
    findFirst.mockResolvedValue(null);
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '6.19.2',
    }));

    await expect(
      createService().updateYunxiaoStatus(
        'org-2',
        'user-1',
        false,
        { yunxiaoOrganizationIdentifier: 'yunxiao-org-1' },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'This Yunxiao organization is already bound to another FlowX organization.',
    });
  });

  it('返回云效项目成员和当前组织的 FlowX 用户', async () => {
    findFirst.mockResolvedValue({ yunxiaoOrganizationIdentifier: 'yunxiao-org-1' });
    listProjectMembers.mockResolvedValue([
      {
        memberId: 'yunxiao-member-1',
        userId: 'yunxiao-user-1',
        aliyunAccountId: 'aliyun-account-1',
        dingTalkId: null,
        displayName: '云效张三',
        displayRealName: null,
        stamp: null,
        roleName: '项目成员',
        roleId: 'member',
      },
    ]);
    mappingFindMany.mockResolvedValue([
      {
        yunxiaoMemberId: 'yunxiao-member-1',
        yunxiaoUserId: 'yunxiao-user-1',
        aliyunAccountId: 'aliyun-account-1',
        yunxiaoUserIdentifier: 'aliyun-account-1',
        flowxUserId: 'flowx-user-1',
      },
    ]);
    organizationMemberFindMany.mockResolvedValue([
      { user: { id: 'flowx-user-1', displayName: '张三', account: 'zhangsan', email: null } },
    ]);

    await expect(createService().listYunxiaoProjectMembers('org-1', 'project-1'))
      .resolves.toMatchObject({
        projectId: 'project-1',
        yunxiaoOrganizationIdentifier: 'yunxiao-org-1',
        members: [{
          memberId: 'yunxiao-member-1',
          userId: 'yunxiao-user-1',
          aliyunAccountId: 'aliyun-account-1',
          flowxUserId: 'flowx-user-1',
        }],
        flowxUsers: [{ id: 'flowx-user-1', displayName: '张三' }],
      });
  });

  it('管理员可以保存和解除云效成员映射', async () => {
    findUnique
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ user: { id: 'flowx-user-1', status: 'ACTIVE' } });
    findFirst.mockResolvedValue({ yunxiaoOrganizationIdentifier: 'yunxiao-org-1' });
    mappingUpsert.mockResolvedValue({
      yunxiaoUserIdentifier: 'yunxiao-user-1',
      yunxiaoDisplayName: '云效张三',
      flowxUserId: 'flowx-user-1',
    });

    await expect(createService().setYunxiaoMemberMapping(
      'org-1',
      'admin-1',
      {
        yunxiaoMemberId: 'yunxiao-member-1',
        yunxiaoUserId: 'yunxiao-user-1',
        aliyunAccountId: 'aliyun-account-1',
        yunxiaoDisplayName: '云效张三',
        flowxUserId: 'flowx-user-1',
      },
    )).resolves.toMatchObject({ flowxUserId: 'flowx-user-1' });
    expect(mappingUpsert).toHaveBeenCalled();

    findUnique.mockResolvedValueOnce({ role: 'admin' });
    await expect(createService().setYunxiaoMemberMapping(
      'org-1',
      'admin-1',
      {
        yunxiaoMemberId: 'yunxiao-member-1',
        yunxiaoUserId: 'yunxiao-user-1',
        aliyunAccountId: 'aliyun-account-1',
        yunxiaoDisplayName: '云效张三',
        flowxUserId: null,
      },
    )).resolves.toEqual({ mapped: false });
    expect(mappingDeleteMany).toHaveBeenCalled();
  });

  it('管理员可以清空当前组织的未匹配人员记录', async () => {
    findUnique.mockResolvedValue({ role: 'admin' });

    await expect(createService().clearYunxiaoUnmatchedRecipients('org-1', 'admin-1'))
      .resolves.toEqual({ deletedCount: 2 });
    expect(recipientDeleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        status: { not: 'MATCHED' },
      },
    });
  });

  it('非管理员不能清空未匹配人员记录', async () => {
    findUnique.mockResolvedValue({ role: 'member' });

    await expect(createService().clearYunxiaoUnmatchedRecipients('org-1', 'user-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(recipientDeleteMany).not.toHaveBeenCalled();
  });
});
