# bazaarswap-mcp

An MCP server for [BazaarSwap](https://bazaar-web.onrender.com): cross-chain swaps into Cardano.
For example, an agent can move USDC on Base into ADA.

| Tool | What it does | Funds |
| --- | --- | --- |
| `get_quote` | Races BazaarSwap's routing backend and returns the best route plus every route found, sorted by net output | read-only |
| `build_swap_tx` | Turns a `quoteId` into transaction data | **unsigned** |

- **Keyless.** It holds no keys and no funds, and never signs or broadcasts. The agent, or the user's
  wallet, signs what `build_swap_tx` returns.
- **Amounts** are in the source token's smallest unit. Cardano's chain id is `"CARDANO"`, and native
  ADA is the zero address.
- **A Cardano recipient is required for a swap into Cardano.** Pass the Cardano address that receives
  the output as `recipientAddress`. Without it the race finds no route.
- **The backend sleeps when idle.** An empty result is usually a cold start: wait about 30 seconds and
  retry once. Quotes expire in about 60 seconds.

## Connect

```bash
claude mcp add bazaarswap -- npx -y bazaarswap-mcp@0.1.0
```

Environment, all optional:

| Variable | Default |
| --- | --- |
| `BAZAAR_API_URL` | `https://bazaar-web.onrender.com` |
| `BAZAAR_API_KEY` | none. Anonymous callers get a lower rate limit. |

It is also listed in the [cardano-defi-mcp](https://github.com/ardey26/cardano-defi-mcp) taxonomy,
which serves it through that server's gateway as `bazaarswap_mcp__get_quote` and
`bazaarswap_mcp__build_swap_tx`. The listing went through the same reviewed PR as every other
protocol.

## Disclosure

BazaarSwap is built by Fortress Enterprises, which also maintains cardano-defi-mcp. The routing
backend is closed source. This package is only its open HTTP client, so you can read exactly what an
agent calls.

## Develop

```bash
npm install
npm test        # mocked, no network
npm run build
npm run execute -- quote   # live dry run against the API; see examples/execute-swap.ts
```

Apache-2.0.
