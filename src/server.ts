import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerSwapTools } from './tools.js';

export const VERSION = '0.1.0';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'bazaarswap-mcp', version: VERSION },
    {
      instructions:
        'BazaarSwap cross-chain swaps into Cardano: get_quote races the routing backend for routes ' +
        '(for example USDC on Base into ADA), build_swap_tx turns a quoteId into an UNSIGNED transaction. ' +
        'This server holds no keys and no funds. Amounts are in the source token\'s smallest unit; ' +
        'Cardano\'s chain id is "CARDANO" and native ADA is the zero address. Providers can fail ' +
        'transiently, so on an empty get_quote result retry once before concluding no route exists. ' +
        'Quotes expire in ~60 seconds.',
    },
  );
  registerSwapTools(server);
  return server;
}
