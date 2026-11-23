import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { pageResult } from './test-utils/page-result';

describe('项目标签真实请求契约', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', { getItem: () => null }); });
  it('管理接口分页搜索与颜色、并发版本、删除路径正确', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => pageResult([]) }); vi.stubGlobal('fetch', fetchMock);
    await api.listProjectLabels('p1', { page: 2, q: '前端' });
    await api.createProjectLabel('p1', { name: '前端', color: 'BLUE' });
    await api.updateProjectLabel('p1', 'l1', { name: 'Web', color: 'RED', updatedAt: 'revision' });
    await api.deleteProjectLabel('p1', 'l1');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('page')).toBe('2');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('q')).toBe('前端');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ name: '前端', color: 'BLUE' });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ name: 'Web', color: 'RED', updatedAt: 'revision' });
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });
  it('原型 ZIP 在创建请求携带标签，显式空数组不丢失', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'i1' }) }); vi.stubGlobal('fetch', fetchMock);
    await api.createPrototypeImport({ projectId: 'p1', labelIds: ['l1', 'l2'] }, new File(['zip'], 'demo.zip'));
    expect((fetchMock.mock.calls[0][1].body as FormData).get('labelIds')).toBe('["l1","l2"]');
    await api.createPrototypeImport({ projectId: 'p1', labelIds: [] }, new File(['zip'], 'demo.zip'));
    expect((fetchMock.mock.calls[1][1].body as FormData).get('labelIds')).toBe('[]');
  });
  it('三类写入、普通及版本查询透传标签，省略更新与清空保持不同', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => pageResult([]) }); vi.stubGlobal('fetch', fetchMock);
    await api.createRequirement({ projectId: 'p1', title: '需求', labelIds: ['l1'] });
    await api.createVersionWorkItem('p1', 'v1', { kind: 'ISSUE', title: '问题', labelIds: ['l1'] });
    await api.createBug({ workspaceId: 'w1', projectId: 'p1', title: '缺陷', description: '描述', labelIds: ['l1'] });
    await api.updateWorkItem('i1', { title: '改名' }); await api.updateWorkItem('i1', { labelIds: [] }); await api.updateBug('b1', { labelIds: [] });
    await api.getRequirements({ projectId: 'p1', labelIds: ['l1', 'l2'] }); await api.getBugs({ projectId: 'p1', labelIds: ['l1', 'l2'] }); await api.listVersionWorkItems('p1', 'v1', { labelIds: ['l1', 'l2'] });
    expect(fetchMock.mock.calls.slice(0, 3).map(call => JSON.parse(call[1].body).labelIds)).toEqual([['l1'], ['l1'], ['l1']]);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).not.toHaveProperty('labelIds');
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).labelIds).toEqual([]); expect(JSON.parse(fetchMock.mock.calls[5][1].body).labelIds).toEqual([]);
    expect(fetchMock.mock.calls.slice(6).map(call => new URL(call[0]).searchParams.get('labelIds'))).toEqual(['l1,l2', 'l1,l2', 'l1,l2']);
  });
});
