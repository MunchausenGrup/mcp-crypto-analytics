# munchausen-crypto-analytics — MCP Server

Remote MCP server exposing Munchausen Lab agent services over Streamable HTTP.
Live at: `https://munchausen-mcp.munlab.workers.dev/mcp`

## Tools

| Tool | Price | Description |
|------|-------|-------------|
| `get_crypto_prices` | Free (5 req/min) | Real-time BTC/ETH/SOL prices |
| `get_market_quote` | $0.01 USDC (x402) | Real-time market quote for any symbols |
| `scrape_url` | $0.005 USDC (x402) | URL → clean extracted text with title |
| `token_safety` | $0.01 USDC (x402) | EVM token rug-pull risk score from live DEX data |
| `fact_check` | $0.02 USDC (x402) | LLM claim verification: verdict + confidence |
| `get_market_analysis` | $0.05 USDC (x402) | AI analysis: sentiment, key levels, risks |
| `get_research_report` | $0.25 USDC (x402) | Full structured market research report |

Paid tools settle via the [x402 protocol](https://www.x402.org/) — USDC on Base,
no signup, no API keys. The MCP response includes the x402 payment requirements
when a paid tool is called without payment.

## Quick connect

Claude Desktop / Cursor / any MCP client with remote-server support:

```json
{
  "mcpServers": {
    "munchausen-crypto": {
      "type": "http",
      "url": "https://munchausen-mcp.munlab.workers.dev/mcp"
    }
  }
}
```

Or via JSON-RPC directly:

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Usage examples (curl)

All calls are `POST` to the `/mcp` endpoint with JSON-RPC 2.0.
Every example below was tested against the live server.

### get_crypto_prices — free, no signup

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_crypto_prices","arguments":{}}}'
# → {"result":{"content":[{"type":"text","text":"{ \"tier\": \"free\", \"data\": { \"btc\": {\"price\":...}, ... } }"}]}}
```

### get_market_quote — paid ($0.01 USDC via x402)

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_market_quote","arguments":{"symbols":"btc,eth"}}}'
```

Without an `X-PAYMENT` header the response contains the x402 402 challenge
(payment requirements: amount in USDC 6-decimal units, payTo address, asset
contract). Sign the EIP-3009 `transferWithAuthorization` and retry with:

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'X-PAYMENT: <base64 of signed payment payload>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_market_quote","arguments":{"symbols":"btc,eth"}}}'
```

Any x402-compatible client handles signing automatically — e.g. TypeScript
[`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) (`fetchWithPayment`)
or the Python `x402` package.

### scrape_url — paid ($0.005 USDC via x402)

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"scrape_url","arguments":{"url":"https://example.com"}}}'
```

### token_safety — paid ($0.01 USDC via x402)

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"token_safety","arguments":{"address":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"}}}'
# address = native USDC on Base (example input)
```

### fact_check — paid ($0.02 USDC via x402)

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fact_check","arguments":{"claim":"The Eiffel Tower is in London"}}}'
```

### get_market_analysis — paid ($0.05 USDC via x402)

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_market_analysis","arguments":{}}}'
```

### get_research_report — paid ($0.25 USDC via x402)

```bash
curl -X POST https://munchausen-mcp.munlab.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_research_report","arguments":{}}}'
```

### Session / transport notes

- `initialize`, `notifications/initialized`, `tools/list`, `tools/call` and
  `ping` are supported; no session id required.
- Health check: `GET https://munchausen-mcp.munlab.workers.dev/health`
- Server card: `GET https://munchausen-mcp.munlab.workers.dev/.well-known/mcp/server-card.json`
- Raw REST API (same backend, direct x402 flow): see
  `https://munchausen-x402.munlab.workers.dev/llms.txt`

## Architecture

Cloudflare Worker (ESM) → service binding → `munchausen-x402` worker
(Hono + x402 payment middleware, Base mainnet USDC).
Static server card at `/.well-known/mcp/server-card.json`.
