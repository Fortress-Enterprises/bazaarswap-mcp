import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../server.js';

describe('bazaarswap-mcp server', () => {
  it('lists exactly get_quote and build_swap_tx', async () => {
    const server = createServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['build_swap_tx', 'get_quote']);
    // Without a Cardano recipient a swap into Cardano finds no route; the schema must say so.
    const recipient = (tools.find((t) => t.name === 'get_quote')?.inputSchema.properties as Record<string, { description?: string }>)
      .recipientAddress.description;
    expect(recipient).toMatch(/Required for a swap into Cardano/);
    await client.close();
  });
});
