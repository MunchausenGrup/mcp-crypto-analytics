/**
 * Munchausen Lab — MCP Gateway Worker (Streamable HTTP)
 *
 * Exposes the x402 crypto analytics API as an MCP server so it can be
 * listed on Smithery / mcp.so / PulseMCP and used by Claude, Cursor, etc.
 *
 * Transport: Streamable HTTP (JSON-RPC 2.0 over POST /mcp)
 * Auth: none for tools/list, tools/call; paid tools require x402 payment
 *       handled by the upstream munchausen-x402 worker (402 flow).
 */

const UPSTREAM = "https://munchausen-x402.munlab.workers.dev";
// env.X402 service binding preferred (avoids workers.dev 1042 loop)
const SERVER_INFO = { name: "munchausen-crypto-analytics", version: "1.0.0" };

const TOOLS = [
  {
    name: "get_crypto_prices",
    description: "Real-time BTC/ETH/SOL prices. Free, no signup. Rate limited to 5 req/min.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_market_quote",
    description: "Real-time market quote for specified symbols (paid: $0.01 USDC via x402).",
    inputSchema: {
      type: "object",
      properties: { symbols: { type: "string", description: "Comma-separated: btc,eth,sol" } },
      required: ["symbols"],
    },
  },
  {
    name: "get_market_analysis",
    description: "AI-generated market analysis with sentiment, key levels, risk factors (paid: $0.05 USDC via x402).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_research_report",
    description: "Full structured market research report: technical, on-chain, outlook (paid: $0.25 USDC via x402).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scrape_url",
    description: "Fetch any URL and return clean extracted text with title (paid: $0.005 USDC via x402).",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Full URL starting with http(s)://" } },
      required: ["url"],
    },
  },
  {
    name: "fact_check",
    description: "LLM fact-check of a claim: verdict (supported/refuted/partially_true/unverifiable), confidence, reasoning (paid: $0.02 USDC via x402).",
    inputSchema: {
      type: "object",
      properties: { claim: { type: "string", description: "The claim to verify" } },
      required: ["claim"],
    },
  },
  {
    name: "token_safety",
    description: "EVM token rug-pull risk screening: liquidity, volume, pair age, heuristic 0-100 risk score from live DEX data (paid: $0.01 USDC via x402).",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "EVM token contract address 0x..." } },
      required: ["address"],
    },
  },
];

function jsonRpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function callUpstream(env, path, xPaymentHeader) {
  const headers = { Accept: "application/json" };
  if (xPaymentHeader) headers["X-PAYMENT"] = xPaymentHeader;
  let resp;
  try {
    resp = (env && env.X402)
      ? await env.X402.fetch(new Request("https://x402.internal" + path, { headers }))
      : await fetch(UPSTREAM + path, { headers });
  } catch (e) {
    return { ok: false, status: 502, data: { upstream_error: String(e) } };
  }
  const body = await resp.text();
  if (resp.status === 402) {
    const requirements = resp.headers.get("X-PAYMENT-REQUIRED") || body;
    return { ok: false, status: 402, requirements };
  }
  try {
    return { ok: resp.ok, status: resp.status, data: JSON.parse(body) };
  } catch {
    return { ok: resp.ok, status: resp.status, data: { raw: body.slice(0, 2000) } };
  }
}

async function handleToolCall(env, name, args, paymentHeader) {
  switch (name) {
    case "get_crypto_prices": {
      const r = await callUpstream(env, "/api/free", null);
      return { content: [{ type: "text", text: JSON.stringify(r.data ?? r.requirements, null, 2) }], isError: !r.ok };
    }
    case "get_market_quote": {
      const syms = encodeURIComponent((args && args.symbols) || "btc,eth,sol");
      const r = await callUpstream(env, `/api/quote?symbol=${syms}`, paymentHeader);
      return { content: [{ type: "text", text: r.status === 402 ? "Payment required (x402): " + r.requirements : JSON.stringify(r.data, null, 2) }], isError: !r.ok };
    }
    case "get_market_analysis": {
      const r = await callUpstream(env, "/api/analyze", paymentHeader);
      return { content: [{ type: "text", text: r.status === 402 ? "Payment required (x402): " + r.requirements : JSON.stringify(r.data, null, 2) }], isError: !r.ok };
    }
    case "get_research_report": {
      const r = await callUpstream(env, "/api/report", paymentHeader);
      return { content: [{ type: "text", text: r.status === 402 ? "Payment required (x402): " + r.requirements : JSON.stringify(r.data, null, 2) }], isError: !r.ok };
    }
    case "scrape_url": {
      const body = JSON.stringify({ url: (args && args.url) || "" });
      let resp;
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (paymentHeader) headers["X-PAYMENT"] = paymentHeader;
      try {
        resp = (env && env.X402)
          ? await env.X402.fetch(new Request("https://x402.internal/api/scrape", { method: "POST", headers, body }))
          : await fetch(UPSTREAM + "/api/scrape", { method: "POST", headers, body });
      } catch (e) {
        return { content: [{ type: "text", text: "Upstream error: " + e }], isError: true };
      }
      const t = await resp.text();
      if (resp.status === 402) return { content: [{ type: "text", text: "Payment required (x402): " + (resp.headers.get("X-PAYMENT-REQUIRED") || t) }], isError: true };
      let data; try { data = JSON.parse(t); } catch { data = { raw: t.slice(0, 2000) }; }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !resp.ok };
    }
    case "fact_check": {
      const body = JSON.stringify({ claim: (args && args.claim) || "" });
      let resp;
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (paymentHeader) headers["X-PAYMENT"] = paymentHeader;
      try {
        resp = (env && env.X402)
          ? await env.X402.fetch(new Request("https://x402.internal/api/fact-check", { method: "POST", headers, body }))
          : await fetch(UPSTREAM + "/api/fact-check", { method: "POST", headers, body });
      } catch (e) {
        return { content: [{ type: "text", text: "Upstream error: " + e }], isError: true };
      }
      const t = await resp.text();
      if (resp.status === 402) return { content: [{ type: "text", text: "Payment required (x402): " + (resp.headers.get("X-PAYMENT-REQUIRED") || t) }], isError: true };
      let data; try { data = JSON.parse(t); } catch { data = { raw: t.slice(0, 2000) }; }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !resp.ok };
    }
    case "token_safety": {
      const body = JSON.stringify({ address: (args && args.address) || "" });
      let resp;
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (paymentHeader) headers["X-PAYMENT"] = paymentHeader;
      try {
        resp = (env && env.X402)
          ? await env.X402.fetch(new Request("https://x402.internal/api/token-safety", { method: "POST", headers, body }))
          : await fetch(UPSTREAM + "/api/token-safety", { method: "POST", headers, body });
      } catch (e) {
        return { content: [{ type: "text", text: "Upstream error: " + e }], isError: true };
      }
      const t = await resp.text();
      if (resp.status === 402) return { content: [{ type: "text", text: "Payment required (x402): " + (resp.headers.get("X-PAYMENT-REQUIRED") || t) }], isError: true };
      let data; try { data = JSON.parse(t); } catch { data = { raw: t.slice(0, 2000) }; }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !resp.ok };
    }
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS for browser-based MCP clients
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, Mcp-Session-Id",
        },
      });
    }

    // Static server card for Smithery (bypasses bot-scan issues)
    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return new Response(JSON.stringify({
        serverInfo: SERVER_INFO,
        authentication: { required: false },
        tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        resources: [],
        prompts: [],
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/health") {
      return jsonRpc(null, { status: "ok", server: SERVER_INFO });
    }

    if (url.pathname !== "/mcp" || request.method !== "POST") {
      return new Response("MCP endpoint: POST /mcp (Streamable HTTP, JSON-RPC 2.0)", { status: 404 });
    }

    let msg;
    try {
      msg = await request.json();
    } catch {
      return jsonRpcError(null, -32700, "Parse error");
    }

    const { id, method, params } = msg;
    const paymentHeader = request.headers.get("X-PAYMENT");

    switch (method) {
      case "initialize":
        return jsonRpc(id, {
          protocolVersion: (params && params.protocolVersion) || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list":
        return jsonRpc(id, { tools: TOOLS });
      case "tools/call": {
        const result = await handleToolCall(env, params.name, params.arguments, paymentHeader);
        return jsonRpc(id, result);
      }
      case "ping":
        return jsonRpc(id, {});
      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  },
};
