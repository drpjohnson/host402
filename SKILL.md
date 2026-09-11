---
name: host402
description: Autonomous cloud hosting and API monetization for AI agents via x402 V2 protocol (Base network USDC) without credit cards or accounts.
---

# Host402 Agent Skill

Deploy websites, web apps, and monetized APIs programmatically using the open **x402 V2** payment protocol. Pay instantly via EVM wallet (USDC on Base) without accounts, dashboards, or credit cards.

## Base URL
Default local endpoint: `http://localhost:4020`
Production endpoint: `https://api.host402.live`

## Capabilities & Workflows

### 1. Deploy a Static Website or Landing Page
Send static files (HTML, CSS, JS, images) and pay via x402:

```bash
# Step 1: Submit deployment request
curl -i -X POST http://localhost:4020/v1/deploy/static \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: dep-$(date +%s)" \
  -d '{
    "files": [
      {
        "path": "index.html",
        "content": "PGgxPkhlbGxvIGZyb20gQWdlbnQ8L2gxPg=="
      }
    ],
    "ttl_days": 30
  }'

# Server responds with 402 Payment Required:
# PAYMENT-REQUIRED: <base64-encoded-payment-details>

# Step 2: Sign the payment using your EVM private key (USDC on Base)
# and resend with PAYMENT-SIGNATURE header:
curl -X POST http://localhost:4020/v1/deploy/static \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: dep-1726090000" \
  -H "PAYMENT-SIGNATURE: <base64-payment-payload>" \
  -d '{ ... }'

# Response: 200 OK
# {
#   "success": true,
#   "id": "dep_01j7...",
#   "url": "http://localhost:4020/sites/dep_01j7/index.html",
#   "expires_at": "2026-10-12T00:00:00Z"
# }
```

### 2. Deploy a Monetized API (Earn USDC per call)
Register an API endpoint wrapped with an automatic x402 paywall:

```bash
curl -X POST http://localhost:4020/v1/deploy/api \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: <base64-payment-payload>" \
  -d '{
    "path": "weather-agent",
    "target_url": "https://my-internal-worker.internal/weather",
    "price_per_call": "0.005",
    "owner_wallet": "0xYourWalletAddress"
  }'

# Any agent calling http://localhost:4020/gateway/weather-agent will receive
# a 402 Payment Required challenge for $0.005 USDC. Platform settles $0.00475
# directly to your owner_wallet!
```

### 3. MCP Server Integration
Connect Host402 directly as an MCP tool inside your agent configuration:

```json
{
  "mcpServers": {
    "host402": {
      "command": "node",
      "args": ["c:/path/to/aihosting/dist/mcp/server.js"]
    }
  }
}
```

Available MCP Tools:
- `host402_deploy_website`: Deploy a static website or landing page.
- `host402_deploy_api`: Deploy a monetized API endpoint.
- `host402_get_site_info`: Check site status, URL, and expiration date.
- `host402_renew_lease`: Extend hosting time for an existing deployment.
