import { createServer as createNodeServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { forwardedFor } from './bazaar.js';
import { createServer } from './server.js';

/**
 * Streamable HTTP at POST /mcp, stateless: every request gets a fresh MCP server and
 * transport, so nothing about one caller outlives its request.
 */
export function createMcpHttpServer(): Server {
  return createNodeServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    // nginx overwrites X-Forwarded-For with the real client address, and this server
    // listens on localhost only, so the first hop can be trusted.
    const callerIp = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();

    try {
      await forwardedFor.run(callerIp, async () => {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      });
    } catch (err) {
      console.error('bazaarswap-mcp: request failed', err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
}
