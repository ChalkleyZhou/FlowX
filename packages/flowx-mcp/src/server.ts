import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FlowXApiClient } from './flowx-api-client.js';
import { registerFlowXTools } from './tools.js';

export async function createFlowXMcpServer() {
  const server = new McpServer({
    name: 'flowx-mcp',
    version: '0.1.0',
  });
  registerFlowXTools(server, {
    apiClient: await FlowXApiClient.forDesignTools(),
    collectGitReport: (await import('./git-report.js')).collectGitReport,
  });
  return server;
}

export async function runStdioServer() {
  const server = await createFlowXMcpServer();
  await server.connect(new StdioServerTransport());
}
