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
