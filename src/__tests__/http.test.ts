import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createMcpHttpServer } from '../http.js';

describe('bazaarswap-mcp over Streamable HTTP', () => {
  let httpServer: Server;
  let base: string;

  beforeAll(async () => {
    httpServer = createMcpHttpServer();
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('serves the same tools as stdio at /mcp', async () => {
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['build_swap_tx', 'get_quote', 'get_swap_status']);
    await client.close();
  });

  it('serves many clients without sessions', async () => {
    const clients = await Promise.all(
      [1, 2, 3].map(async () => {
        const client = new Client({ name: 't', version: '0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
        return client;
      }),
    );
    for (const client of clients) {
      expect((await client.listTools()).tools).toHaveLength(3);
      await client.close();
    }
  });

  it('passes the caller IP from nginx on to the Bazaar API', async () => {
    const realFetch = globalThis.fetch;
    const upstream: Headers[] = [];
    vi.stubEnv('BAZAAR_API_URL', 'http://bazaar.test');
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith('http://bazaar.test')) return realFetch(input, init);
      upstream.push(new Headers(init?.headers));
      return Response.json({ txData: { to: '0x1', data: '0x', value: '0' }, quote: {} });
    });

    try {
      const client = new Client({ name: 't', version: '0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { 'x-forwarded-for': '203.0.113.7' } },
        }),
      );
      await client.callTool({ name: 'build_swap_tx', arguments: { quoteId: 'q', userAddress: '0xabc' } });
      await client.close();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }

    expect(upstream).toHaveLength(1);
    expect(upstream[0].get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it('rejects GET on /mcp: there is no server-initiated stream', async () => {
    const res = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('answers /health and 404s everything else', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
