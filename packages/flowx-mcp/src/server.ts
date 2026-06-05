import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerFlowXTools } from './tools.js';

export function createFlowXMcpServer() {
  const server = new McpServer({
    name: 'flowx-mcp',
    version: '0.1.0',
  });
  registerFlowXTools(server);
  return server;
}

export async function runStdioServer() {
  const server = createFlowXMcpServer();
  await server.connect(new StdioServerTransport());
}
