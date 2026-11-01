# bazaarswap-mcp

An MCP server for [BazaarSwap](https://app.bazaarswap.io): cross-chain swaps into Cardano.
For example, an agent can move USDC on Base into ADA.

| Tool | What it does | Funds |
| --- | --- | --- |
| `get_quote` | Races BazaarSwap's routing backend and returns the best route plus every route found, best first after fees the wallet pays on top | read-only |
| `build_swap_tx` | Turns a `quoteId` into transaction data | **unsigned** |

- **Keyless.** It holds no keys and no funds, and never signs or broadcasts. The agent, or the user's
  wallet, signs what `build_swap_tx` returns.
- **Amounts** are in the source token's smallest unit. Cardano's chain id is `"CARDANO"`, and native
  ADA is the zero address.
- **A Cardano recipient is required for a swap into Cardano.** Pass the Cardano address that receives
  the output as `recipientAddress`. Without it the race finds no route.
- **Retry an empty result once.** Providers can fail transiently. Quotes expire in about 60 seconds.

## Connect

Hosted, nothing to install:

```bash
claude mcp add --transport http bazaarswap https://api.bazaarswap.io/mcp
```

Or run it locally over stdio:

```bash
claude mcp add bazaarswap -- npx -y bazaarswap-mcp@0.2.0
```

Environment, all optional:

| Variable | Default |
| --- | --- |
| `BAZAAR_API_URL` | `https://api.bazaarswap.io` |
| `BAZAAR_API_KEY` | none. Anonymous callers get a lower rate limit. |

`bazaarswap-mcp --http` serves Streamable HTTP at `POST /mcp` instead of stdio, on `HOST:PORT`
(default `127.0.0.1:3002`). That is how the hosted endpoint runs: see `deploy/`.

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

Merging to `main` deploys the hosted endpoint once CI passes (`.github/workflows/deploy.yml`).

Apache-2.0.
