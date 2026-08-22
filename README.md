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

## Architecture

Cloudflare Worker (ESM) → service binding → `munchausen-x402` worker
(Hono + x402 payment middleware, Base mainnet USDC).
Static server card at `/.well-known/mcp/server-card.json`.
