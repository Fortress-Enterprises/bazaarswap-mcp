#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpHttpServer } from './http.js';
import { createServer } from './server.js';

if (process.argv.includes('--http')) {
  const port = Number(process.env.PORT ?? 3002);
  const host = process.env.HOST ?? '127.0.0.1';
  createMcpHttpServer().listen(port, host, () => {
    console.error(`bazaarswap-mcp listening on http://${host}:${port}/mcp`);
  });
} else {
  await createServer().connect(new StdioServerTransport());
}
