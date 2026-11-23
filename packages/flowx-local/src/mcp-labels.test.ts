import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalMcpServer } from './mcp.js';

const label = { id: 'label-1', name: '前端', color: 'BLUE' };
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20, totalPages: 1 });
const createInput = { projectId: 'project-1', versionId: 'version-1', kind: 'REQUIREMENT', title: '标签需求' };
const homes: string[] = [];
const originalEnv = { token: process.env.FLOWX_API_TOKEN, url: process.env.FLOWX_API_BASE_URL };
const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];

beforeEach(() => {
  process.env.FLOWX_API_TOKEN = 'test-token';
  process.env.FLOWX_API_BASE_URL = 'https://flowx.example/api';
  calls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  if (originalEnv.token === undefined) delete process.env.FLOWX_API_TOKEN;
  else process.env.FLOWX_API_TOKEN = originalEnv.token;
  if (originalEnv.url === undefined) delete process.env.FLOWX_API_BASE_URL;
  else process.env.FLOWX_API_BASE_URL = originalEnv.url;
});

async function usingClient(run: (client: Client) => Promise<void>) {
  const homeDir = mkdtempSync(join(tmpdir(), 'flowx-labels-mcp-'));
  homes.push(homeDir);
  const server = createLocalMcpServer({ homeDir });
  const client = new Client({ name: 'labels-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

function mockApi(respond?: (call: typeof calls[number]) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const call = {
      url: new URL(String(input)), method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
    };
    calls.push(call);
    if (respond) return respond(call);
    if (call.url.pathname.endsWith('/labels')) return Response.json(page([label]));
    if (call.url.pathname.includes('/versions/') && call.method === 'GET') return Response.json({ items: [{ id: 'work-1', labels: [label] }], nextCursor: null });
    if (call.method === 'GET') return Response.json({ id: 'work-1', projectId: 'project-1', labels: [label] });
    const labels = call.body?.labelIds === undefined ? [label] : (call.body.labelIds as string[]).map((id) => ({ ...label, id }));
    return Response.json({ id: 'work-1', projectId: 'project-1', labels });
  });
}

function body(result: Awaited<ReturnType<Client['callTool']>>) {
  return String((result.content as Array<{ text: string }>)[0].text);
}

describe('项目标签 MCP 契约', () => {
  it('可发现标签分页工具以及三个工作项工具的数组 schema', async () => {
    await usingClient(async (client) => {
      const { tools } = await client.listTools();
      const listing = tools.find((tool) => tool.name === 'flowx_list_project_labels');
      expect(listing).toBeDefined();
      expect(listing?.inputSchema.properties).toHaveProperty('projectId');
      expect(listing?.description).toContain('Web');
      for (const name of ['flowx_create_work_item', 'flowx_update_work_item', 'flowx_list_version_work_items']) {
        expect(tools.find((tool) => tool.name === name)?.inputSchema.properties).toHaveProperty('labelIds');
      }
    });
  });

  it('分页查询按项目编码并保留标签管理字段与分页元数据', async () => {
    mockApi(() => Response.json({ ...page([{ ...label, projectId: 'project/a', updatedAt: '2026-11-23', workItemCount: 3 }]), page: 2, pageSize: 5 }));
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_list_project_labels', arguments: { projectId: 'project/a', page: 2, pageSize: 5, q: '前端 & UX' } });
      expect(result.isError).not.toBe(true);
      expect(calls[0].url.pathname).toBe('/api/projects/project%2Fa/labels');
      expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ page: '2', pageSize: '5', q: '前端 & UX' });
      expect(JSON.parse(body(result))).toMatchObject({ items: [{ ...label, workItemCount: 3 }], page: 2, pageSize: 5 });
    });
  });

  it('创建请求透传去重标签，更新 [] 原子清空并保留完整响应', async () => {
    mockApi();
    await usingClient(async (client) => {
      const created = await client.callTool({ name: 'flowx_create_work_item', arguments: { ...createInput, labelIds: ['label-1', 'label-1'] } });
      expect(created.isError).not.toBe(true);
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ labelIds: ['label-1'] });
      expect(JSON.parse(body(created)).labels).toEqual([label]);
      const updated = await client.callTool({ name: 'flowx_update_work_item', arguments: { workItemId: 'work-1', labelIds: [], title: '清空标签' } });
      expect(updated.isError).not.toBe(true);
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ title: '清空标签', labelIds: [] });
      expect(JSON.parse(body(updated)).labels).toEqual([]);
    });
  });

  it('版本列表把标签数组序列化为逗号过滤，保留响应 labels', async () => {
    mockApi();
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_list_version_work_items', arguments: { projectId: 'project-1', versionId: 'version-1', labelIds: ['label-1', 'label-2', 'label-1'] } });
      expect(result.isError).not.toBe(true);
      expect(calls.find((call) => call.url.pathname.endsWith('/work-items'))?.url.searchParams.get('labelIds')).toBe('label-1,label-2');
      expect(JSON.parse(body(result)).items[0].labels).toEqual([label]);
    });
  });

  it.each([null, 'label-1', [null], [1], [''], ['  '], ['label,other'], Array.from({ length: 21 }, (_, index) => `label-${index}`)].map((labelIds) => ({ labelIds })))('schema 拒绝非法标签 $labelIds，且不发送 HTTP', async ({ labelIds }) => {
    const fetch = mockApi();
    await usingClient(async (client) => {
      for (const [name, arguments_] of [
        ['flowx_create_work_item', createInput],
        ['flowx_update_work_item', { workItemId: 'work-1' }],
        ['flowx_list_version_work_items', { projectId: 'project-1', versionId: 'version-1' }],
      ] as const) {
        const result = await client.callTool({ name, arguments: { ...arguments_, labelIds } });
        expect(result.isError).toBe(true);
      }
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('未指定标签的旧请求不发送新字段、不探测能力且接受旧响应', async () => {
    mockApi(() => Response.json({ id: 'work-1' }));
    await usingClient(async (client) => {
      const created = await client.callTool({ name: 'flowx_create_work_item', arguments: createInput });
      const updated = await client.callTool({ name: 'flowx_update_work_item', arguments: { workItemId: 'work-1', title: '旧请求' } });
      expect(created.isError).not.toBe(true);
      expect(updated.isError).not.toBe(true);
      expect(calls.map((call) => call.method)).toEqual(['POST', 'PATCH']);
      expect(calls.every((call) => !Object.hasOwn(call.body ?? {}, 'labelIds'))).toBe(true);
    });
  });

  it('仅明确缺少标签 GET 路由时报告能力不足，写入前停止', async () => {
    mockApi((call) => Response.json({ statusCode: 404, message: `Cannot GET ${call.url.pathname}` }, { status: 404 }));
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_create_work_item', arguments: { ...createInput, labelIds: ['label-1'] } });
      expect(result.isError).toBe(true);
      expect(body(result)).toContain('PROJECT_LABELS_UPGRADE_REQUIRED');
      expect(calls.map((call) => call.method)).toEqual(['GET']);
    });
  });

  it.each([401, 403, 404, 500])('标签探测 HTTP %i 原样返回，不能误判为旧服务端', async (status) => {
    mockApi(() => Response.json({ message: '资源不可访问' }, { status }));
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_create_work_item', arguments: { ...createInput, labelIds: [] } });
      expect(result.isError).toBe(true);
      expect(body(result)).toContain(`(${status})`);
      expect(body(result)).not.toContain('UPGRADE_REQUIRED');
      expect(calls.map((call) => call.method)).toEqual(['GET']);
    });
  });

  it('网络错误不误判能力缺失，也不继续写入', async () => {
    mockApi(() => { throw Error('network unavailable'); });
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_create_work_item', arguments: { ...createInput, labelIds: [] } });
      expect(result.isError).toBe(true);
      expect(body(result)).toContain('network unavailable');
      expect(body(result)).not.toContain('UPGRADE_REQUIRED');
      expect(calls).toHaveLength(1);
    });
  });

  it.each([undefined, [], [{ ...label, id: 'wrong-label' }]].map((labels) => ({ labels })))('写入响应未确认所需标签 $labels 时不能伪报成功或重试', async ({ labels }) => {
    mockApi((call) => call.method === 'GET' ? Response.json(page([label])) : Response.json({ id: 'work-1', ...(labels !== undefined ? { labels } : {}) }));
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_create_work_item', arguments: { ...createInput, labelIds: ['label-1'] } });
      expect(result.isError).toBe(true);
      expect(body(result)).toContain('PROJECT_LABELS_WRITE_UNCONFIRMED');
      expect(body(result)).toContain('work-1');
      expect(body(result)).toContain('已保存');
      expect(body(result)).toContain('不要重复创建');
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
  });

  it('执行上下文原样保留标签参考元信息', async () => {
    mockApi(() => Response.json({ workItem: { id: 'work-1', labels: [label] }, phase: 'execute' }));
    await usingClient(async (client) => {
      const result = await client.callTool({ name: 'flowx_get_task_context', arguments: { executionItemId: 'item-1' } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(body(result)).workItem.labels).toEqual([label]);
    });
  });
});
