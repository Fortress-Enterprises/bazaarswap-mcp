# bazaarswap-mcp

An MCP server for [BazaarSwap](https://app.bazaarswap.io): cross-chain swaps into Cardano.
For example, an agent can move USDC on Base into ADA.

| Tool | What it does | Funds |
| --- | --- | --- |
| `get_quote` | Races BazaarSwap's routing backend and returns the best route plus every route found, best first after fees the wallet pays on top | read-only |
| `build_swap_tx` | Turns a `quoteId` into transaction data | **unsigned** |
| `get_swap_status` | Follows a submitted swap, from its tx hash and the `tracking` token `build_swap_tx` returns, until it completes or fails | read-only |

- **Keyless.** It holds no keys and no funds, and never signs or broadcasts. The agent, or the user's
  wallet, signs what `build_swap_tx` returns.
- **Amounts** are in the source token's smallest unit. Cardano's chain id is `"CARDANO"`, and native
  ADA is the zero address.
- **A Cardano recipient is required for a swap into Cardano.** Pass the Cardano address that receives
  the output as `recipientAddress`. Without it the race finds no route.
- **Retry an empty result once.** Providers can fail transiently. Quotes expire in about 60 seconds.

## Connect

The hosted endpoint needs no install, no key and no account:

```
https://api.bazaarswap.io/mcp
```

It speaks Streamable HTTP. Any client that supports remote MCP servers can use that URL. Setup for
the common clients follows.

Once connected, try a first prompt such as:

> Quote swapping 5 USDC on Arbitrum into ADA, delivered to `addr1…`. Show the best route and its fees.

### Claude Code

```bash
claude mcp add --transport http bazaarswap https://api.bazaarswap.io/mcp
```

### Claude Desktop and claude.ai

1. Open **Settings → Connectors** (some versions call it **Customize → Connectors**).
2. Click **Add custom connector**.
3. Name it `BazaarSwap`, paste `https://api.bazaarswap.io/mcp`, and click **Add**.

The Free plan allows one custom connector. On Team and Enterprise, an owner adds it for the
organization. Do not put the URL in `claude_desktop_config.json`: that file is for local servers only.
To run the server on your own machine instead, see [Run it locally](#run-it-locally).

### Cursor

Add this to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` for one project:

```json
{
  "mcpServers": {
    "bazaarswap": { "url": "https://api.bazaarswap.io/mcp" }
  }
}
```

### VS Code (GitHub Copilot agent mode)

Add this to `.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "bazaarswap": { "type": "http", "url": "https://api.bazaarswap.io/mcp" }
  }
}
```

Or add it to your user profile from a shell:

```bash
code --add-mcp '{"name":"bazaarswap","type":"http","url":"https://api.bazaarswap.io/mcp"}'
```

### Codex CLI

```bash
codex mcp add bazaarswap --url https://api.bazaarswap.io/mcp
```

Or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.bazaarswap]
url = "https://api.bazaarswap.io/mcp"
```

### Gemini CLI

```bash
gemini mcp add --transport http bazaarswap https://api.bazaarswap.io/mcp
```

In `~/.gemini/settings.json` the field is `httpUrl`, not `url`. Gemini CLI reads `url` as an SSE
endpoint:

```json
{
  "mcpServers": {
    "bazaarswap": { "httpUrl": "https://api.bazaarswap.io/mcp" }
  }
}
```

### Ollama

Ollama runs models but is not an MCP client itself. Use a client that connects Ollama models to MCP
servers. Pick a model that supports tool calling, such as `qwen3`, `llama3.1` or `mistral-nemo`.
Small models often get the amount units wrong: amounts are in the token's smallest unit, so 5 USDC is
`5000000`. Use 8B parameters or more.

**ollmcp**, a terminal chat:

```bash
pip install --upgrade ollmcp          # or: uv tool install ollmcp
ollama pull qwen3
ollmcp --mcp-server-url https://api.bazaarswap.io/mcp --model qwen3
```

**Open WebUI**, a browser chat (v0.6.31 or later, admin only):

1. Open **Admin Settings → External Tools** and click **+**.
2. Set the type to **MCP (Streamable HTTP)**. Do not pick OpenAPI.
3. Paste `https://api.bazaarswap.io/mcp`, leave auth empty, and save.

### Any other client

If a client only runs local (stdio) servers, bridge it to the hosted endpoint with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "bazaarswap": { "command": "npx", "args": ["-y", "mcp-remote", "https://api.bazaarswap.io/mcp"] }
  }
}
```

### Run it locally

The hosted endpoint is the supported way to connect. To run the server yourself, for example with
your own `BAZAAR_API_KEY`, build it from source:

```bash
git clone https://github.com/Fortress-Enterprises/bazaarswap-mcp && cd bazaarswap-mcp
npm ci && npm run build
claude mcp add bazaarswap -- node "$PWD/dist/index.js"
```

For another client, use `node /absolute/path/to/bazaarswap-mcp/dist/index.js` as the local server
command, for example in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bazaarswap": { "command": "node", "args": ["/absolute/path/to/bazaarswap-mcp/dist/index.js"] }
  }
}
```

The npm package (`bazaarswap-mcp@0.1.0`) predates the hosted endpoint: it calls the old backend and
ranks routes without fees paid on top. Prefer the hosted endpoint or a source build.

Environment, all optional:

| Variable | Default |
| --- | --- |
| `BAZAAR_API_URL` | `https://api.bazaarswap.io` |
| `BAZAAR_API_KEY` | none. Anonymous callers get a lower rate limit. |

`node dist/index.js --http` serves Streamable HTTP at `POST /mcp` instead of stdio, on `HOST:PORT`
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
